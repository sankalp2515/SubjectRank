/**
 * Training/serving parity suite.
 *
 * Runs the TypeScript feature extractor over the frozen corpus and asserts it
 * agrees element-wise with parity/expected.json, which the Python extractor
 * produced from the same corpus.
 *
 * This exists because training happens in Python and inference happens in a
 * serverless function in TypeScript (D-006). That is a training/serving skew risk
 * by construction, and the mitigation is a test that fails loudly rather than a
 * promise to be careful.
 *
 * Exit code 0 = the two implementations agree. Non-zero = do not deploy.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { extract, FEATURE_NAMES, FEATURE_SPEC_VERSION } from '../web/src/lib/features.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

// Absolute tolerance. Both sides do the same operations in the same order in
// IEEE-754 double precision, so exact equality is *nearly* achievable; the
// tolerance covers division and the Flesch arithmetic where operand ordering can
// differ by a single ULP. Anything larger than this is a real divergence.
const TOL = 1e-9;

type Expected = {
  spec_version: number;
  feature_names: string[];
  n_features: number;
  count: number;
  rows: { text: string; vector: number[] }[];
};

const expected: Expected = JSON.parse(
  readFileSync(join(HERE, 'expected.json'), 'utf-8'),
);

const fail = (msg: string) => {
  console.error(`\x1b[31mPARITY FAILED\x1b[0m  ${msg}`);
  process.exit(1);
};

// --- structural checks first: these catch whole classes of error at once ---
if (expected.spec_version !== FEATURE_SPEC_VERSION) {
  fail(
    `spec version mismatch: expected.json is v${expected.spec_version}, ` +
      `features.ts is v${FEATURE_SPEC_VERSION}. A model trained under one spec ` +
      `must never be served by an extractor at another.`,
  );
}
if (expected.feature_names.length !== FEATURE_NAMES.length) {
  fail(
    `feature count mismatch: Python ${expected.feature_names.length}, ` +
      `TypeScript ${FEATURE_NAMES.length}`,
  );
}
for (let i = 0; i < FEATURE_NAMES.length; i++) {
  if (expected.feature_names[i] !== FEATURE_NAMES[i]) {
    fail(
      `feature ORDER mismatch at index ${i}: Python "${expected.feature_names[i]}", ` +
        `TypeScript "${FEATURE_NAMES[i]}". The ONNX graph is positional -- this ` +
        `would silently feed every feature into the wrong slot.`,
    );
  }
}

// --- element-wise comparison ----------------------------------------------
type Divergence = {
  text: string;
  feature: string;
  py: number;
  ts: number;
  delta: number;
};

const divergences: Divergence[] = [];
let threw = 0;

for (const row of expected.rows) {
  let got: number[];
  try {
    got = extract(row.text);
  } catch (e) {
    threw++;
    console.error(
      `  THREW on ${JSON.stringify(row.text).slice(0, 60)}: ${(e as Error).message}`,
    );
    continue;
  }
  if (got.length !== row.vector.length) {
    fail(`length mismatch on ${JSON.stringify(row.text)}`);
  }
  for (let i = 0; i < got.length; i++) {
    const delta = Math.abs(got[i] - row.vector[i]);
    if (!(delta <= TOL)) {
      divergences.push({
        text: row.text,
        feature: FEATURE_NAMES[i],
        py: row.vector[i],
        ts: got[i],
        delta,
      });
    }
  }
}

const nCells = expected.rows.length * FEATURE_NAMES.length;

if (threw || divergences.length) {
  console.error('');
  console.error(
    `\x1b[31mPARITY FAILED\x1b[0m  ${divergences.length} divergent cells, ` +
      `${threw} exceptions, out of ${nCells} compared`,
  );
  console.error('');

  // Group by feature: one broken feature produces hundreds of divergent cells,
  // and the feature name is the actionable part, not the individual strings.
  const byFeature = new Map<string, Divergence[]>();
  for (const d of divergences) {
    const list = byFeature.get(d.feature) ?? [];
    list.push(d);
    byFeature.set(d.feature, list);
  }
  const sorted = [...byFeature.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [feature, ds] of sorted) {
    console.error(`  \x1b[1m${feature}\x1b[0m  (${ds.length} strings)`);
    for (const d of ds.slice(0, 3)) {
      console.error(
        `    ${JSON.stringify(d.text).slice(0, 58).padEnd(60)} ` +
          `py=${d.py}  ts=${d.ts}  Δ=${d.delta.toExponential(3)}`,
      );
    }
    if (ds.length > 3) console.error(`    ... and ${ds.length - 3} more`);
  }
  console.error('');
  console.error(
    '  Fix: decide which side violates docs/FEATURES.md, correct THAT side, and',
  );
  console.error(
    '  if the spec itself was ambiguous, tighten the spec before touching code.',
  );
  process.exit(1);
}

console.log(
  `\x1b[32mPARITY OK\x1b[0m  ${expected.rows.length} strings x ` +
    `${FEATURE_NAMES.length} features = ${nCells} cells agree within ${TOL}`,
);
console.log(`          feature spec v${FEATURE_SPEC_VERSION}`);
