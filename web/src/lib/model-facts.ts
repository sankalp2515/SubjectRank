import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Facts about the deployed model, for pages that state them as prose.
 *
 * The handed-over design hardcoded `MEDIAN_TRAINING_CHARS = 54` and printed it
 * on two pages as "the median length of a training headline". The deployed
 * champion reports its own value, and it is not 54. A number in body copy is a
 * claim like any other, so it is read from the artifact rather than typed into
 * the source where it can quietly go stale.
 *
 * Deliberately does NOT load the ONNX graph. These pages need three numbers from
 * a small JSON file; pulling in onnxruntime to render prose would put a native
 * dependency on a static page's critical path for nothing.
 */
export type ModelFacts = {
  ready: boolean;
  version: string | null;
  /** Median character count of the headlines the model was fitted on. */
  trainingCharMedian: number | null;
  featureCount: number | null;
  excludedFeatures: string[];
};

const ARTIFACT_DIR = path.join(process.cwd(), 'model');

export async function modelFacts(): Promise<ModelFacts> {
  try {
    const raw = await readFile(path.join(ARTIFACT_DIR, 'champion.meta.json'), 'utf-8');
    const meta = JSON.parse(raw) as {
      version?: string;
      training_char_median?: number;
      feature_names?: string[];
      excluded_features?: string[];
    };
    return {
      ready: true,
      version: meta.version ?? null,
      trainingCharMedian: meta.training_char_median ?? null,
      featureCount: meta.feature_names?.length ?? null,
      excludedFeatures: meta.excluded_features ?? [],
    };
  } catch {
    // No promoted champion in this build. Callers render the absence rather
    // than a placeholder number.
    return {
      ready: false,
      version: null,
      trainingCharMedian: null,
      featureCount: null,
      excludedFeatures: [],
    };
  }
}
