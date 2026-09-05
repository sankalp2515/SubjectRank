/*
 * Ported from the handed-over design (exact-match-main/src/routes/compare.tsx).
 * Layout and copy are the design's; the route wrapper and metadata are App
 * Router equivalents of the TanStack originals.
 */
export const metadata = {
  title: 'Compare subject lines — SubjectRank',
  description:
    'Paste 2–5 email subject lines and see the pairwise ranking, the reasoning behind every placing, and the pairs the model cannot separate.',
};

import { PageShell } from '@/components/subjectrank/site-chrome';
import { CompareApp } from '@/components/subjectrank/compare-app';
import { Notice } from '@/components/subjectrank/primitives';
import { adapt } from '@/lib/subjectrank/adapt';
import { readWorkedExample } from '@/lib/worked';
import worked from '@/lib/generated/worked_example.json';

export default function ComparePage() {
  /*
   * The worked example is built by ml/scripts/build_worked_example.py using the
   * promoted ONNX graph, and its reasoning is computed here by the same
   * TypeScript attribution the live path uses (D-027).
   *
   * The design generated this in the browser from its rules engine. Doing that
   * now would mean the first comparison a visitor sees is the only one on the
   * page the deployed model never produced — and it is the one they will judge
   * the tool by.
   */
  const w = readWorkedExample(worked);

  if (!w.ready) {
    // No promoted champion in this build. Say so rather than showing an
    // example that came from somewhere else.
    return (
      <PageShell wide>
        <Notice tone="unknown" label="No model deployed">
          There is no promoted model in this build, so there is nothing to compare
          with and no worked example to show. This page will work as soon as one is
          promoted.
        </Notice>
      </PageShell>
    );
  }

  const example = adapt({
    comparison: w.comparison,
    trainingCharMedian: w.trainingCharMedian,
    excludedFeatures: w.excludedFeatures,
  });

  return (
    <PageShell wide>
      <CompareApp example={example} />
    </PageShell>
  );
}
