import { NextResponse } from 'next/server';

import { ModelNotTrainedError, loadModel, rank } from '@/lib/model';
import { PRODUCT } from '@/lib/product';
import { requestContext } from '@/lib/request-context';

export const runtime = 'nodejs';   // onnxruntime-node needs it; not edge.
export const dynamic = 'force-dynamic';

const { minLines, maxLines, maxChars } = PRODUCT.limits;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send JSON with a "lines" array.' }, { status: 400 });
  }

  const lines = (body as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) {
    return NextResponse.json({ error: 'Send JSON with a "lines" array.' }, { status: 400 });
  }

  const cleaned = lines
    .filter((l): l is string => typeof l === 'string')
    .map((l) => l.trim())
    .filter(Boolean);

  if (cleaned.length < minLines) {
    return NextResponse.json(
      { error: `Give at least ${minLines} lines — this compares them against each other.` },
      { status: 400 },
    );
  }
  if (cleaned.length > maxLines) {
    return NextResponse.json(
      { error: `That's more than ${maxLines} lines. Drop a few and compare again.` },
      { status: 400 },
    );
  }
  const tooLong = cleaned.find((l) => l.length > maxChars);
  if (tooLong) {
    return NextResponse.json(
      { error: `One line is ${tooLong.length} characters. The limit is ${maxChars}.` },
      { status: 400 },
    );
  }

  // Session establishment sits inside the try. It can fail for reasons that have
  // nothing to do with the model - a missing SESSION_SECRET, or the auth service
  // rate-limiting - and an unhandled throw here surfaced to the user as a bare 500
  // while the model was perfectly healthy.
  let ctx;
  try {
    ctx = await requestContext();
  } catch (e) {
    console.error('[rank] session', e);
    return NextResponse.json(
      { error: 'Could not start a session, so nothing was compared. Try again in a moment.' },
      { status: 503 },
    );
  }
  const { data, userId } = ctx;

  if (!(await data.rateLimitOk(userId))) {
    return NextResponse.json(
      { error: 'That is a lot of comparisons in a short time. Wait a minute and try again.' },
      { status: 429 },
    );
  }

  let comparison;
  try {
    comparison = await rank(cleaned);
  } catch (e) {
    if (e instanceof ModelNotTrainedError) {
      // Honest 503, not a fabricated ranking.
      return NextResponse.json(
        { error: 'No ranking model is deployed yet, so there is nothing to compare with.' },
        { status: 503 },
      );
    }
    console.error('[rank]', e);
    return NextResponse.json(
      { error: 'The comparison failed on our side. Nothing you did — try again.' },
      { status: 500 },
    );
  }

  const { meta } = await loadModel();
  const saved = await data.saveRanking({
    userId,
    modelVersion: comparison.modelVersion,
    featureSpecVersion: comparison.featureSpecVersion,
    inferenceMs: comparison.inferenceMs,
    items: comparison.lines
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((l) => ({
        positionInInput: l.index,
        text: l.text,
        features: l.features,
        score: l.score,
        rank: l.rank,
        pairwise: l.pairwise,
        confidence: l.confidence,
      })),
  });

  await data.recordEvent(userId, 'ranking_shown', saved.rankingId);

  return NextResponse.json({
    comparison,
    rankingId: saved.rankingId,
    itemIds: saved.itemIds,
    excludedFeatures: meta.excluded_features,
    // The gauge's datum. Comes from the live model so the page shows the
    // distribution the DEPLOYED model was trained on, not whatever was current
    // when the page was last built.
    trainingCharMedian: meta.training_char_median ?? null,
  });
}
