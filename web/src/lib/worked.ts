import 'server-only';

/**
 * Turn the build-time worked example into the same shape a live comparison has.
 *
 * `ml/scripts/build_worked_example.py` computes the ranking with the promoted
 * ONNX graph, which is the honest way to get the scores: they come from the model
 * that is actually deployed. What it cannot produce is the attribution — the
 * notes and the marks drawn on the text — because that logic lives in
 * `lib/attribution.ts` and exists in exactly one language on purpose.
 *
 * Reimplementing it in Python to fill this JSON would create a third
 * implementation of the same rules, which is the skew problem D-006 exists to
 * prevent, applied to the surface where a wrong answer is a fabricated sentence
 * about a user's own words.
 *
 * So the scores come from Python and the reasoning comes from the TypeScript the
 * server already runs. Both read the same `champion.meta.json`, so they cannot
 * disagree about which features the model uses or what their coefficients are.
 */
import { notesFor, marksFor } from './attribution';
import { normalise } from './features';
import type { Comparison, ModelMeta, RankedLine } from './model';

type WorkedLine = {
  index: number;
  text: string;
  rank: number;
  score: number;
  confidence: number;
  features: Record<string, number>;
  pairwise: Record<string, number>;
};

export type WorkedExample = {
  status: 'ready' | 'untrained';
  modelVersion: string | null;
  comparison: {
    modelVersion: string;
    featureSpecVersion: number;
    lines: WorkedLine[];
    tooCloseToCall: Array<[number, number]>;
    inferenceMs: number;
  } | null;
  meta?: ModelMeta;
};

export type Worked =
  | { ready: false }
  | {
      ready: true;
      comparison: Comparison;
      trainingCharMedian: number | null;
      excludedFeatures: string[];
    };

export function readWorkedExample(raw: unknown): Worked {
  const w = raw as WorkedExample;
  if (w.status !== 'ready' || !w.comparison || !w.meta) return { ready: false };

  const meta = w.meta;

  const lines: RankedLine[] = w.comparison.lines.map((l) => {
    // The mean of the OTHER lines, which is the comparison the sentences claim.
    // Keyed on the line's own index rather than on its position in this array,
    // because the array is in rank order and the features are not.
    const others = w.comparison!.lines
      .filter((o) => o.index !== l.index)
      .map((o) => o.features);

    const notes = notesFor(meta, l.features, others);
    const normalisedText = normalise(l.text);

    return {
      index: l.index,
      text: l.text,
      normalisedText,
      rank: l.rank,
      score: l.score,
      confidence: l.confidence,
      features: l.features,
      // The JSON round-trip turns the numeric keys into strings; the UI indexes
      // this by input position, so it is put back the way a live ranking has it.
      pairwise: Object.fromEntries(
        Object.entries(l.pairwise).map(([k, v]) => [Number(k), v]),
      ),
      notes,
      marks: marksFor(normalisedText, notes, meta, l.features),
    };
  });

  return {
    ready: true,
    comparison: {
      modelVersion: w.comparison.modelVersion,
      featureSpecVersion: w.comparison.featureSpecVersion,
      lines,
      tooCloseToCall: w.comparison.tooCloseToCall,
      inferenceMs: w.comparison.inferenceMs,
    },
    trainingCharMedian: meta.training_char_median ?? null,
    excludedFeatures: meta.excluded_features ?? [],
  };
}
