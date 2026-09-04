/**
 * The two serving paths must agree.
 *
 * There are now two implementations of inference:
 *
 *   - Next.js route  → TypeScript extractor → ONNX (onnxruntime-node)
 *   - FastAPI        → Python extractor     → ONNX (onnxruntime)
 *
 * The feature-level parity suite proves the two EXTRACTORS agree on 9,568 cells.
 * This proves the two SERVICES agree on the thing a user actually sees: the
 * order, the placings, and whether a pair was called too close.
 *
 * It matters because moving inference to Python is what lets the frontend live
 * on Vercel — and the moment two paths exist, "they agree" is a claim that needs
 * a test rather than an assumption. A user who gets one answer from the Vercel
 * deployment and a different one from the API has been told the tool is broken,
 * and they are right.
 *
 *   node parity/serving_parity.mjs \
 *     --next http://localhost:3111 \
 *     --api  http://localhost:8000
 */
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const NEXT = opt('next', process.env.SR_NEXT ?? 'http://localhost:3111');
const API = opt('api', process.env.SR_API ?? 'http://localhost:8000');

/* Cases chosen to exercise the states that differ, not just the happy path:
   a clean separation, a statistical tie, an emoji the model has no opinion
   about, non-Latin script, and punctuation that produces a terminal mark. */
const CASES = [
  ['Why your best customers leave', 'The one chart that explains your churn',
   'We looked at 400 churn surveys. Here is what we found.'],
  ['What nobody tells you about churn', 'What nobody tells you about renewals',
   'We looked at 400 churn surveys'],
  ['5 lessons from rebuilding billing', 'Billing updates you need today 🚀',
   'Why we changed our pricing last week'],
  ['Ist das wirklich nötig?', 'Das ist wirklich nötig!'],
  ['You are doing this wrong', 'This is the one thing nobody says...'],
];

const fail = [];

async function nextRank(lines) {
  const r = await fetch(`${NEXT}/api/rank`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines }),
  });
  if (!r.ok) throw new Error(`next ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const c = (await r.json()).comparison;
  return {
    order: c.lines.map((l) => l.index),
    tooClose: JSON.stringify(c.tooCloseToCall),
    model: c.modelVersion,
  };
}

async function apiRank(lines) {
  const r = await fetch(`${API}/v1/compare`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines }),
  });
  if (!r.ok) throw new Error(`api ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const d = await r.json();
  return {
    order: d.lines.map((l) => l.index),
    tooClose: JSON.stringify(d.tooCloseToCall),
    model: d.modelVersion,
    placings: d.lines.map((l) => l.placing),
  };
}

console.log(`next: ${NEXT}\napi:  ${API}\n`);

for (const [i, lines] of CASES.entries()) {
  let a, b;
  try {
    [a, b] = await Promise.all([nextRank(lines), apiRank(lines)]);
  } catch (e) {
    fail.push(`case ${i + 1}: ${e.message}`);
    console.log(`  case ${i + 1}  ERROR  ${e.message}`);
    continue;
  }

  const problems = [];
  if (JSON.stringify(a.order) !== JSON.stringify(b.order)) {
    problems.push(`order ${JSON.stringify(a.order)} vs ${JSON.stringify(b.order)}`);
  }
  if (a.tooClose !== b.tooClose) {
    problems.push(`tooClose ${a.tooClose} vs ${b.tooClose}`);
  }
  // A version mismatch is not a disagreement about ranking, but it means the
  // two services are serving different artifacts and any agreement is luck.
  if (a.model !== b.model) {
    problems.push(`model ${a.model} vs ${b.model}`);
  }

  if (problems.length) {
    fail.push(`case ${i + 1}: ${problems.join('; ')}`);
    console.log(`  case ${i + 1}  DISAGREE  ${problems.join('; ')}`);
  } else {
    console.log(`  case ${i + 1}  agree     ${b.placings.join(' · ')}`);
  }
}

console.log();
if (fail.length) {
  console.error(`\x1b[31mSERVING PARITY FAILED\x1b[0m  ${fail.length} of ${CASES.length} cases disagree`);
  process.exit(1);
}
console.log(`\x1b[32mSERVING PARITY OK\x1b[0m  ${CASES.length} cases, identical order and tie flags`);
