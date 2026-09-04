/** The whole persistence surface. Both implementations satisfy exactly this. */
export type Session = { userId: string; isAnonymous: boolean };

export type RankingRecord = {
  userId: string;
  modelVersion: string;
  featureSpecVersion: number;
  inferenceMs: number;
  items: Array<{
    positionInInput: number;
    text: string;
    features: Record<string, number>;
    score: number;
    rank: number;
    pairwise: Record<number, number>;
    confidence: number;
  }>;
};

export type FeedbackRecord = {
  userId: string;
  rankingId: string;
  rankingItemId?: string;
  modelVersion: string;
  comment?: string;
};

export type OutcomeRecord = {
  userId: string;
  rankingId: string;
  sentItemId: string;
  listSize?: number;
  opens?: number;
  clicks?: number;
  provider?: string;
  appleMailShareEstimate?: number;
  notes?: string;
};

/**
 * The funnel's closed enum, as a value.
 *
 * It was written out three times: as a TypeScript union here, as an `ALLOWED`
 * array in `app/api/event/route.ts` that the route checks membership against,
 * and as a CHECK constraint in `supabase/migrations/0005`. Three copies of one
 * list, and only the third is enforced at runtime — so a name added to the union
 * and to the route would be accepted by the API, rejected by Postgres, and then
 * swallowed, because `recordEvent` deliberately never throws.
 *
 * Two of the three now come from this array. The SQL constraint stays a separate
 * copy by necessity, and adding an event still requires a migration, which is the
 * point: it forces a decision about what is worth recording.
 */
export const EVENT_NAMES = [
  'landed', 'example_seen', 'input_focused', 'compare_clicked',
  'ranking_shown', 'attribution_expanded', 'disagreed',
  'account_prompt_shown', 'account_created',
  'outcome_prompt_shown', 'outcome_reported',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** Membership test for untrusted input. Narrows, so callers keep their types. */
export const isEventName = (v: unknown): v is EventName =>
  typeof v === 'string' && (EVENT_NAMES as readonly string[]).includes(v);

/**
 * Comparisons per user per window, for /api/rank.
 *
 * Both data layers enforce the same budget and each used to declare it inline —
 * one in seconds, one in milliseconds. Same numbers, two units, no way to change
 * the limit in one place.
 */
export const RATE_LIMIT = { max: 30, windowSeconds: 60 } as const;

export type AdminSummary = {
  funnel: Array<{ name: string; count: number }>;
  rankings24h: number;
  feedback: Array<{ id: string; createdAt: string; modelVersion: string; comment: string | null; lines: string[] }>;
  models: Array<{ version: string; status: string; createdAt: string; pairs: number | null }>;
  drift: { lastRunAt: string | null; maxPsi: number | null; flagged: string[] } | null;
  liveFeatureMeans: Record<string, number>;
};

export interface DataLayer {
  readonly kind: 'mock' | 'supabase';
  /**
   * Register the caller's identity. The identity itself comes from the signed
   * session cookie (lib/session.ts), NOT from the database client - see the note
   * there for why deriving it from an auth call was wrong.
   */
  ensureSession(userId: string, isNew: boolean): Promise<Session>;
  /** True only if this ranking belongs to this user. Guards the write endpoints. */
  ownsRanking(userId: string, rankingId: string): Promise<boolean>;
  rateLimitOk(userId: string): Promise<boolean>;
  saveRanking(r: RankingRecord): Promise<{ rankingId: string; itemIds: string[] }>;
  /**
   * Attach an address to the caller's existing identity.
   *
   * Deliberately an upgrade rather than a sign-up: the anonymous visitor already
   * has a stable uid and rows attached to it, so keeping the same uid means the
   * work they did before deciding to keep it follows them, with no merge step.
   * Nothing about the product is gated behind this.
   */
  attachEmail(userId: string, email: string): Promise<void>;
  saveFeedback(f: FeedbackRecord): Promise<void>;
  saveOutcome(o: OutcomeRecord): Promise<void>;
  recordEvent(userId: string | null, name: EventName, rankingId?: string): Promise<void>;
  adminSummary(): Promise<AdminSummary>;
  /**
   * Per-feature samples from recent submissions, for drift.
   * PSI needs a distribution; passing it a single mean produced a constant ~12.4
   * for every feature regardless of whether anything had actually drifted.
   */
  liveFeatureSamples(limit?: number): Promise<Record<string, number[]>>;
  saveMonitoringRun(row: Record<string, unknown>): Promise<void>;
  deleteMyData(userId: string): Promise<Record<string, number>>;
}
