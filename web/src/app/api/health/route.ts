import { NextResponse } from 'next/server';

import { ModelNotTrainedError, loadModel } from '@/lib/model';
import { FEATURE_SPEC_VERSION } from '@/lib/features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Readiness, for Container Apps and for the Docker HEALTHCHECK.
 *
 * It loads the ONNX session rather than returning a bare 200, because "the Node
 * process is listening" and "this replica can answer the only question the
 * product exists to answer" are different claims, and a rollout that promotes a
 * replica on the first one is how a container with an unreadable model ends up
 * taking traffic and serving 503s to visitors.
 *
 * `loadModel()` caches, so this is a real check exactly once per replica and a
 * map lookup on every probe after that.
 *
 * It reports the model version and the artifact hash on purpose: after a deploy,
 * the fastest way to answer "which model is actually live right now?" should not
 * be to read a pipeline log.
 */
export async function GET() {
  try {
    const { meta } = await loadModel();
    return NextResponse.json({
      ok: true,
      model: meta.version,
      algorithm: meta.algorithm,
      featureSpecVersion: meta.feature_spec_version,
      extractorSpecVersion: FEATURE_SPEC_VERSION,
      features: meta.feature_names.length,
      excluded: meta.excluded_features.length,
      artifactSha256: meta.artifact_sha256 ?? null,
    });
  } catch (e) {
    // Not ready is a 503, and it says which of the two failures it is. A model
    // that is absent and a model that mismatches the extractor need different
    // fixes, and a single "unhealthy" tells the person on call neither.
    const notTrained = e instanceof ModelNotTrainedError;
    console.error('[health]', e);
    return NextResponse.json(
      {
        ok: false,
        reason: notTrained ? 'no-model' : 'model-load-failed',
        detail: (e as Error).message,
      },
      { status: 503 },
    );
  }
}
