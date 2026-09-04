import { NextResponse } from 'next/server';
import { refuseUnlessOwned, requestContext } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "This ranking is wrong" — one click, no form.
 *
 * Disagreement is the most valuable signal this product collects, so the write
 * path is as short as it can be and the comment is genuinely optional.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { rankingId?: string; rankingItemId?: string; comment?: string; modelVersion?: string } | null;

  if (!body?.rankingId) {
    return NextResponse.json({ error: 'Missing rankingId.' }, { status: 400 });
  }
  if (body.comment && body.comment.length > 2000) {
    return NextResponse.json({ error: 'That comment is over the 2,000 character limit.' }, { status: 400 });
  }

  const ctx = await requestContext();
  // Ownership check. The service-role client bypasses RLS, so without this a
  // guessed ranking UUID was enough to attach rows to a stranger's comparison.
  const refused = await refuseUnlessOwned(ctx, body.rankingId);
  if (refused) return refused;

  await ctx.data.saveFeedback({
    userId: ctx.userId,
    rankingId: body.rankingId,
    rankingItemId: body.rankingItemId,
    modelVersion: body.modelVersion ?? 'unknown',
    comment: body.comment,
  });
  await ctx.data.recordEvent(ctx.userId, 'disagreed', body.rankingId);
  return NextResponse.json({ ok: true });
}
