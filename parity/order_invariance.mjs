/*
 * Paste-order invariance, measured end to end through the real HTTP API.
 *
 * "A ranking must never change if the user reorders their inputs" is the one
 * constraint that, if broken, makes every other number in this repo irrelevant:
 * a stranger who pastes the same lines twice and gets two answers has correctly
 * concluded the tool is broken.
 *
 * ml/tests already asserts antisymmetry on the fitted model, and the export gate
 * asserts it on the ONNX graph (D-013). This asserts the property that actually
 * reaches a user, through feature extraction, the graph, the Borda aggregation
 * and JSON serialisation -- every one of which could reintroduce an ordering
 * dependence that a model-level test would not see.
 *
 * Needs the app running:  cd web && npm run dev
 * Then:                   node parity/order_invariance.mjs
 */

const LINES = [
  'Why your best customers leave',
  'The one chart that explains your churn',
  'We looked at 400 churn surveys. Here is what we found.',
  'This is what nobody tells you about churn',
];

function permutations(a) {
  if (a.length <= 1) return [a];
  const out = [];
  for (let i = 0; i < a.length; i++) {
    const rest = [...a.slice(0, i), ...a.slice(i + 1)];
    for (const p of permutations(rest)) out.push([a[i], ...p]);
  }
  return out;
}

/* Target is overridable so the same check can be pointed at a dev server, a
   container, or a deployed Container App revision. The property must hold for
   the artifact that ships, not only for the one on a laptop. */
const BASE = process.env.SR_BASE ?? 'http://localhost:3111';

let cookie = '';
async function rank(lines) {
  const res = await fetch(`${BASE}/api/rank`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ lines }),
  });
  const setC = res.headers.get('set-cookie');
  if (setC && !cookie) cookie = setC.split(';')[0];
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(await res.json())}`);
  return res.json();
}

const perms = permutations(LINES);
console.log(`${perms.length} permutations of ${LINES.length} lines against ${BASE}`);

let reference = null;
let worstScoreDrift = 0;
let disagreements = 0;

for (const p of perms) {
  const body = await rank(p);
  const c = body.comparison;
  // Map back to the canonical text so orderings are comparable.
  const orderedTexts = c.lines.map((l) => p[l.index]);
  // Score keyed by text, not by input position.
  const byText = Object.fromEntries(c.lines.map((l) => [p[l.index], l.score]));

  if (reference === null) {
    reference = { orderedTexts, byText };
    continue;
  }
  const sameOrder =
    JSON.stringify(orderedTexts) === JSON.stringify(reference.orderedTexts);
  if (!sameOrder) {
    disagreements++;
    console.log('  ORDER CHANGED for input order:', p.map((t) => t.slice(0, 22)));
    console.log('    got     ', orderedTexts.map((t) => t.slice(0, 22)));
    console.log('    expected', reference.orderedTexts.map((t) => t.slice(0, 22)));
  }
  for (const t of LINES) {
    worstScoreDrift = Math.max(worstScoreDrift, Math.abs(byText[t] - reference.byText[t]));
  }
}

console.log(`ranking order differed in ${disagreements} of ${perms.length - 1} comparisons`);
console.log(`largest score drift for the same line across permutations: ${worstScoreDrift.toExponential(3)}`);
console.log(disagreements === 0 && worstScoreDrift < 1e-9
  ? 'PASS  the ranking is invariant to paste order'
  : 'FAIL  paste order changes the answer');
process.exit(disagreements === 0 && worstScoreDrift < 1e-9 ? 0 : 1);
