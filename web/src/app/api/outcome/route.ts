import { NextResponse } from 'next/server';
import { refuseUnlessOwned, requestContext } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What actually happened when the user sent one of the lines.
 *
 * Collects clicks as well as opens on purpose: Apple Mail Privacy Protection
 * pre-fetches tracking pixels, so a reported open rate is measured through a
 * distorted instrument (Q-004). Clicks are also what the training data measured,
 * which keeps the reported outcome and the training label commensurable.
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b?.rankingId || !b?.sentItemId) {
    return NextResponse.json({ error: 'Tell us which ranking and which line you sent.' }, { status: 400 });
  }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const opens = num(b.opens);
  const clicks = num(b.clicks);
  if (opens === undefined && clicks === undefined) {
    return NextResponse.json(
      { error: 'Give either opens or clicks — one number is enough.' },
      { status: 400 },
    );
  }

  const share = num(b.appleMailShareEstimate);
  if (share !== undefined && share > 1) {
    return NextResponse.json({ error: 'Apple Mail share is a fraction between 0 and 1.' }, { status: 400 });
  }

  const ctx = await requestContext();
  const refused = await refuseUnlessOwned(ctx, String(b.rankingId));
  if (refused) return refused;

  await ctx.data.saveOutcome({
    userId: ctx.userId,
    rankingId: String(b.rankingId),
    sentItemId: String(b.sentItemId),
    listSize: num(b.listSize),
    opens, clicks,
    provider: typeof b.provider === 'string' ? b.provider.slice(0, 80) : undefined,
    appleMailShareEstimate: share,
    notes: typeof b.notes === 'string' ? b.notes.slice(0, 2000) : undefined,
  });
  await ctx.data.recordEvent(ctx.userId, 'outcome_reported', String(b.rankingId));
  return NextResponse.json({ ok: true });
}
