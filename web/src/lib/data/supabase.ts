/**
 * Postgres-backed data layer. Written tonight, first run in the morning.
 *
 * Uses the service-role key and therefore BYPASSES RLS. That is correct for a
 * server-side route that has already established which user it is acting for, and
 * it is exactly why this file must never be imported from a client component:
 * `import 'server-only'` makes that a build error rather than a code review note.
 */
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RATE_LIMIT } from './types';
import type {
  AdminSummary, DataLayer, EventName, FeedbackRecord, OutcomeRecord,
  RankingRecord, Session,
} from './types';

export class SupabaseDataLayer implements DataLayer {
  readonly kind = 'supabase' as const;
  private db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /**
   * Anonymous-first (§3), with the identity supplied by the signed cookie.
   *
   * Critically this NEVER calls `this.db.auth.signInAnonymously()`. supabase-js
   * prefers a live session token over the API key, so doing that would replace the
   * service-role credential on this cached singleton with whichever anonymous user
   * signed in last - and two concurrent requests would then write under each
   * other's identity. The admin API used here creates the user without touching
   * this client's own credential.
   */
  async ensureSession(userId: string, isNew: boolean): Promise<Session> {
    if (isNew) {
      const { error } = await this.db.auth.admin.createUser({
        id: userId,
        email_confirm: false,
        user_metadata: { anonymous: true },
      } as never);
      // A duplicate id means the cookie outlived a redeploy; that is fine.
      if (error && !/already|duplicate|exists/i.test(error.message)) {
        throw new Error(`could not register session: ${error.message}`);
      }
    }
    await this.db.from('sessions').upsert(
      { user_id: userId, is_anonymous: true, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    return { userId, isAnonymous: true };
  }

  /**
   * Attach an address to the caller's existing anonymous user.
   *
   * `updateUserById` keeps the uid, so every ranking, note and reported outcome
   * already attached to this visitor follows them - which is why the interface
   * can honestly call this "keeping your comparisons" rather than "signing up".
   * It does not sign anyone in and the interface does not claim it does.
   */
  async attachEmail(userId: string, email: string): Promise<void> {
    const { error } = await this.db.auth.admin.updateUserById(userId, {
      email,
      user_metadata: { anonymous: false },
    } as never);
    if (error) throw new Error(`could not attach that address: ${error.message}`);
    await this.db.from('sessions').update({
      is_anonymous: false,
      upgraded_at: new Date().toISOString(),
    }).eq('user_id', userId);
  }

  /**
   * Ownership check for the write endpoints.
   *
   * The service-role client bypasses RLS, so without this the foreign key was the
   * only barrier - and a foreign key only proves an id exists. Anyone who guessed
   * a ranking UUID could attach feedback or a reported outcome to a stranger's
   * ranking, which is the ground-truth label channel that drives retraining.
   */
  async ownsRanking(userId: string, rankingId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('rankings').select('id').eq('id', rankingId).eq('user_id', userId).maybeSingle();
    if (error) return false;
    return Boolean(data);
  }

  async rateLimitOk(userId: string): Promise<boolean> {
    const since = new Date(Date.now() - RATE_LIMIT.windowSeconds * 1000).toISOString();
    const { count, error } = await this.db
      .from('rankings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('created_at', since);
    // Fail OPEN on a counting error: a database hiccup should not look like abuse
    // to a legitimate user. Abuse that slips through is visible in the funnel.
    if (error) return true;
    return (count ?? 0) < RATE_LIMIT.max;
  }

  async saveRanking(r: RankingRecord) {
    const { data: ranking, error } = await this.db.from('rankings').insert({
      user_id: r.userId,
      model_version: r.modelVersion,
      feature_spec_version: r.featureSpecVersion,
      n_lines: r.items.length,
      inference_ms: r.inferenceMs,
    }).select('id').single();
    if (error || !ranking) throw new Error(`saveRanking: ${error?.message}`);

    const { data: items, error: itemErr } = await this.db.from('ranking_items').insert(
      r.items.map((it) => ({
        ranking_id: ranking.id,
        user_id: r.userId,
        position_in_input: it.positionInInput,
        text: it.text,
        features: it.features,
        score: it.score,
        rank: it.rank,
        pairwise: it.pairwise,
        confidence: it.confidence,
      })),
    ).select('id, position_in_input');
    if (itemErr) throw new Error(`saveRanking items: ${itemErr.message}`);

    const ids = (items ?? [])
      .sort((a, b) => a.position_in_input - b.position_in_input)
      .map((i) => i.id);
    return { rankingId: ranking.id as string, itemIds: ids };
  }

  async saveFeedback(f: FeedbackRecord) {
    const { error } = await this.db.from('feedback').insert({
      user_id: f.userId, ranking_id: f.rankingId, ranking_item_id: f.rankingItemId,
      model_version: f.modelVersion, comment: f.comment ?? null,
    });
    if (error) throw new Error(`saveFeedback: ${error.message}`);
  }

  async saveOutcome(o: OutcomeRecord) {
    const { error } = await this.db.from('outcomes').insert({
      user_id: o.userId, ranking_id: o.rankingId, sent_item_id: o.sentItemId,
      list_size: o.listSize ?? null, opens: o.opens ?? null, clicks: o.clicks ?? null,
      provider: o.provider ?? null,
      apple_mail_share_estimate: o.appleMailShareEstimate ?? null,
      notes: o.notes ?? null,
    });
    if (error) throw new Error(`saveOutcome: ${error.message}`);
  }

  async recordEvent(userId: string | null, name: EventName, rankingId?: string) {
    // Analytics must never break the product: a failed event write is swallowed.
    await this.db.from('events')
      .insert({ user_id: userId, name, ranking_id: rankingId ?? null })
      .then(undefined, () => undefined);
  }

  async adminSummary(): Promise<AdminSummary> {
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const [events, rankings, feedback, models, drift, recentItems] = await Promise.all([
      this.db.from('events').select('name').gt('created_at', dayAgo),
      this.db.from('rankings').select('id', { count: 'exact', head: true }).gt('created_at', dayAgo),
      this.db.from('feedback').select('id, created_at, model_version, comment, ranking_id')
        .order('created_at', { ascending: false }).limit(25),
      this.db.from('models').select('version, status, created_at, n_training_pairs')
        .order('created_at', { ascending: false }).limit(20),
      this.db.from('monitoring_runs').select('created_at, max_psi, flagged_features')
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      this.db.from('ranking_items').select('features').order('created_at', { ascending: false }).limit(500),
    ]);

    const counts = new Map<string, number>();
    for (const e of events.data ?? []) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);

    const rankingIds = (feedback.data ?? []).map((f) => f.ranking_id).filter(Boolean);
    const itemsByRanking = new Map<string, string[]>();
    if (rankingIds.length) {
      const { data: fbItems } = await this.db
        .from('ranking_items').select('ranking_id, text, rank')
        .in('ranking_id', rankingIds).order('rank');
      for (const it of fbItems ?? []) {
        const list = itemsByRanking.get(it.ranking_id) ?? [];
        list.push(it.text);
        itemsByRanking.set(it.ranking_id, list);
      }
    }

    const means: Record<string, number> = {};
    const feats = (recentItems.data ?? []).map((r) => r.features as Record<string, number>);
    if (feats.length) {
      for (const key of Object.keys(feats[0])) {
        means[key] = feats.reduce((a, f) => a + (f[key] ?? 0), 0) / feats.length;
      }
    }

    return {
      funnel: [...counts].map(([name, count]) => ({ name, count })),
      rankings24h: rankings.count ?? 0,
      feedback: (feedback.data ?? []).map((f) => ({
        id: f.id, createdAt: f.created_at, modelVersion: f.model_version,
        comment: f.comment,
        // The lines the disagreement was about. Previously hardcoded to [], which
        // meant the signal the product calls its most valuable arrived with no
        // context attached.
        lines: (itemsByRanking.get(f.ranking_id) ?? []),
      })),
      models: (models.data ?? []).map((m) => ({
        version: m.version, status: m.status, createdAt: m.created_at,
        pairs: m.n_training_pairs,
      })),
      drift: drift.data
        ? {
            lastRunAt: drift.data.created_at,
            maxPsi: drift.data.max_psi,
            flagged: drift.data.flagged_features ?? [],
          }
        : null,
      liveFeatureMeans: means,
    };
  }

  /**
   * Delete everything belonging to this user.
   *
   * Deletes explicitly by user_id rather than calling the parameterless
   * `delete_my_data()` RPC. That function scopes itself by `auth.uid()`, which on a
   * service-role client is not the caller - so the earlier version accepted a
   * userId, discarded it, and could delete a different user's rows (or none) while
   * the page told the visitor their data was gone. The RPC remains in the schema
   * for a future browser-side path where auth.uid() IS the caller.
   */
  async liveFeatureSamples(limit = 2000): Promise<Record<string, number[]>> {
    const { data } = await this.db
      .from('ranking_items').select('features')
      .order('created_at', { ascending: false }).limit(limit);
    const out: Record<string, number[]> = {};
    for (const row of data ?? []) {
      const f = row.features as Record<string, number>;
      for (const [k, v] of Object.entries(f ?? {})) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        (out[k] ??= []).push(v);
      }
    }
    return out;
  }

  /** C6: the cron computed drift and returned it as JSON without ever writing it,
   *  so the admin page's drift panel could never show anything. */
  async saveMonitoringRun(row: Record<string, unknown>): Promise<void> {
    const { error } = await this.db.from('monitoring_runs').insert(row);
    if (error) throw new Error(`saveMonitoringRun: ${error.message}`);
  }

  async deleteMyData(userId: string) {
    const tables = ['events', 'outcomes', 'feedback', 'ranking_items', 'rankings', 'sessions'];
    const deleted: Record<string, number> = {};
    for (const t of tables) {
      const { count, error } = await this.db
        .from(t).delete({ count: 'exact' }).eq('user_id', userId);
      if (error) throw new Error(`deleteMyData(${t}): ${error.message}`);
      deleted[t] = count ?? 0;
    }
    return deleted;
  }
}
