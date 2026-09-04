/**
 * In-memory data layer. Lets the whole app run end to end with no credentials.
 *
 * It is a real implementation of the interface, not a set of stubs: the flows
 * exercised against it are the flows that will run against Postgres, so wiring
 * bugs surface tonight rather than tomorrow morning.
 */
import { randomUUID } from 'node:crypto';
import { RATE_LIMIT } from './types';
import type {
  AdminSummary, DataLayer, EventName, FeedbackRecord, OutcomeRecord,
  RankingRecord, Session,
} from './types';

type StoredRanking = RankingRecord & { id: string; createdAt: string; itemIds: string[] };

const RATE_LIMIT_WINDOW_MS = RATE_LIMIT.windowSeconds * 1000;

export class MockDataLayer implements DataLayer {
  readonly kind = 'mock' as const;

  private rankings: StoredRanking[] = [];
  private feedback: Array<FeedbackRecord & { id: string; createdAt: string }> = [];
  private outcomes: Array<OutcomeRecord & { id: string; createdAt: string }> = [];
  private events: Array<{ name: EventName; userId: string | null; at: number }> = [];
  private hits = new Map<string, number[]>();
  private known = new Set<string>();
  private emails = new Map<string, string>();

  /**
   * Identity comes from the caller's signed cookie, not from a field on this
   * singleton. The previous version held ONE process-wide `sessionId`, so every
   * visitor shared an identity: the rate limiter throttled all users collectively,
   * and one visitor pressing delete wiped every other visitor's rows.
   */
  async ensureSession(userId: string): Promise<Session> {
    this.known.add(userId);
    return { userId, isAnonymous: true };
  }

  async ownsRanking(userId: string, rankingId: string): Promise<boolean> {
    return this.rankings.some((r) => r.id === rankingId && r.userId === userId);
  }

  async attachEmail(userId: string, email: string): Promise<void> {
    this.emails.set(userId, email);
  }

  async saveMonitoringRun(): Promise<void> { /* nothing persists in memory */ }

  async liveFeatureSamples(limit = 2000): Promise<Record<string, number[]>> {
    const out: Record<string, number[]> = {};
    for (const it of this.rankings.flatMap((r) => r.items).slice(-limit)) {
      for (const [k, v] of Object.entries(it.features)) {
        if (typeof v === 'number' && Number.isFinite(v)) (out[k] ??= []).push(v);
      }
    }
    return out;
  }

  async rateLimitOk(userId: string): Promise<boolean> {
    const now = Date.now();
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT.max) { this.hits.set(userId, recent); return false; }
    recent.push(now);
    this.hits.set(userId, recent);
    return true;
  }

  async saveRanking(r: RankingRecord) {
    const id = randomUUID();
    const itemIds = r.items.map(() => randomUUID());
    this.rankings.push({ ...r, id, itemIds, createdAt: new Date().toISOString() });
    return { rankingId: id, itemIds };
  }

  async saveFeedback(f: FeedbackRecord) {
    this.feedback.push({ ...f, id: randomUUID(), createdAt: new Date().toISOString() });
  }

  async saveOutcome(o: OutcomeRecord) {
    this.outcomes.push({ ...o, id: randomUUID(), createdAt: new Date().toISOString() });
  }

  async recordEvent(userId: string | null, name: EventName) {
    this.events.push({ name, userId, at: Date.now() });
  }

  async adminSummary(): Promise<AdminSummary> {
    const counts = new Map<string, number>();
    for (const e of this.events) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);

    const dayAgo = Date.now() - 86_400_000;
    const means: Record<string, number> = {};
    const items = this.rankings.flatMap((r) => r.items);
    if (items.length) {
      for (const key of Object.keys(items[0].features)) {
        means[key] = items.reduce((a, it) => a + (it.features[key] ?? 0), 0) / items.length;
      }
    }

    return {
      funnel: [...counts].map(([name, count]) => ({ name, count })),
      rankings24h: this.rankings.filter((r) => Date.parse(r.createdAt) > dayAgo).length,
      feedback: this.feedback.slice(-25).reverse().map((f) => ({
        id: f.id,
        createdAt: f.createdAt,
        modelVersion: f.modelVersion,
        comment: f.comment ?? null,
        lines: this.rankings.find((r) => r.id === f.rankingId)?.items.map((i) => i.text) ?? [],
      })),
      models: [],
      drift: null,
      liveFeatureMeans: means,
    };
  }

  async deleteMyData(userId: string) {
    const before = {
      rankings: this.rankings.length, feedback: this.feedback.length,
      outcomes: this.outcomes.length, events: this.events.length,
    };
    this.rankings = this.rankings.filter((r) => r.userId !== userId);
    this.feedback = this.feedback.filter((f) => f.userId !== userId);
    this.outcomes = this.outcomes.filter((o) => o.userId !== userId);
    this.events = this.events.filter((e) => e.userId !== userId);
    this.emails.delete(userId);
    return {
      rankings: before.rankings - this.rankings.length,
      feedback: before.feedback - this.feedback.length,
      outcomes: before.outcomes - this.outcomes.length,
      events: before.events - this.events.length,
    };
  }
}
