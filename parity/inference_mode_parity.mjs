/**
 * The frontend must rank identically whether inference is local or remote.
 *
 * `SUBJECTRANK_API_URL` switches the Next app between running the ONNX graph
 * in-process and delegating that one step to the FastAPI service. Everything
 * else -- normalisation, extraction, aggregation, attribution -- runs in the
 * Next process either way, so the two modes SHOULD be indistinguishable.
 *
 * "Should" is the reason this file exists. The Vercel deployment runs the remote
 * mode and every local test runs the other one, so without this check the mode
 * that users actually hit is the mode nothing verifies.
 *
 * This is stricter than serving_parity.mjs on purpose. That one asks whether two
 * services agree about the ORDER. This one asks whether the same service, fed
 * probabilities from two different places, produces the same scores to the last
 * decimal, the same tie flags, the same reasoning sentences, and the same
 * character offsets for the highlights. Attribution is where this project has
 * already shipped a bug that contradicted the number beside it; a check that
 * stopped at the ordering would not have caught it.
 *
 * Run two servers on the same repo -- Next refuses two dev servers at once, so
 * start them one after the other:
 *
 *   npx next dev -p 3111
 *   node parity/inference_mode_parity.mjs --capture local  --base http://localhost:3111
 *   # stop it, then:
 *   SUBJECTRANK_API_URL=https://... npx next dev -p 3111
 *   node parity/inference_mode_parity.mjs --capture remote --base http://localhost:3111
 *   node parity/inference_mode_parity.mjs --compare
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const OUT = opt('out', path.join('parity', '.modes'));
const BASE = opt('base', 'http://localhost:3111');
const capture = opt('capture');

/* The same five cases serving_parity uses, so a disagreement can be compared
   across both checks rather than being confounded by different inputs. */
const CASES = [
  ['Why your best customers leave', 'The one chart that explains your churn',
   'We looked at 400 churn surveys. Here is what we found.'],
  ['What nobody tells you about churn', 'What nobody tells you about renewals',
   'We looked at 400 churn surveys'],
  ['5 lessons from rebuilding billing', 'Billing updates you need today 🚀',
   'Why we changed our pricing last week'],
  ['Ist das wirklich nötig?', 'Das ist wirklich nötig!'],
  ['You are doing this wrong', 'This is the one thing nobody says...'],
  /* The five above produce marks in exactly ONE case, which makes a claim about
     character offsets rest on a single highlight. These two are here to exercise
     the marked features deliberately: digits, ALL-CAPS words and a question. */
  ['5 WAYS to fix onboarding TODAY', 'Five ways to fix onboarding'],
  ['Can you spot the difference?', 'Nobody can spot the difference'],
];

async function captureMode(name) {
  const out = [];
  for (const [i, lines] of CASES.entries()) {
    const r = await fetch(`${BASE}/api/rank`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lines }),
    });
    if (!r.ok) throw new Error(`case ${i + 1}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const c = (await r.json()).comparison;
    out.push({
      model: c.modelVersion,
      order: c.lines.map((l) => l.index),
      // Full precision. Rounding here would hide exactly the drift worth finding.
      scores: c.lines.map((l) => l.score),
      tooClose: c.tooCloseToCall,
      notes: c.lines.map((l) => l.notes.map((n) => `${n.kind}:${n.text}`)),
      marks: c.lines.map((l) => l.marks.map((m) => `${m.start}-${m.end}`)),
    });
    console.log(`  case ${i + 1} captured`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(out, null, 1));
  console.log(`\ncaptured ${CASES.length} cases as "${name}" from ${BASE}`);
}

function compare() {
  for (const n of ['local', 'remote']) {
    if (!existsSync(path.join(OUT, `${n}.json`))) {
      console.error(`missing ${OUT}/${n}.json -- capture both modes first`);
      process.exit(2);
    }
  }
  const L = JSON.parse(readFileSync(path.join(OUT, 'local.json'), 'utf8'));
  const R = JSON.parse(readFileSync(path.join(OUT, 'remote.json'), 'utf8'));

  let bad = 0, maxDelta = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = R[i];
    const problems = [];
    for (const k of ['order', 'tooClose', 'notes', 'marks']) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) problems.push(k);
    }
    if (a.model !== b.model) problems.push(`model ${a.model} vs ${b.model}`);
    const d = Math.max(...a.scores.map((s, k) => Math.abs(s - b.scores[k])));
    maxDelta = Math.max(maxDelta, d);
    // Exact equality, not a tolerance: both modes run the same ONNX graph on the
    // same float32 inputs, so anything but 0 means something reordered or
    // re-rounded on the way through HTTP and is worth stopping for.
    if (d !== 0) problems.push(`score delta ${d.toExponential(3)}`);

    if (problems.length) { bad++; console.log(`  case ${i + 1}  DIFFER  ${problems.join('; ')}`); }
    else console.log(`  case ${i + 1}  identical`);
  }

  console.log(`\nlargest score delta: ${maxDelta.toExponential(3)}`);
  if (bad) {
    console.error(`\x1b[31mINFERENCE MODE PARITY FAILED\x1b[0m  ${bad} of ${L.length} cases differ`);
    process.exit(1);
  }
  console.log(`\x1b[32mINFERENCE MODE PARITY OK\x1b[0m  ${L.length} cases identical incl. reasoning and offsets`);
}

if (capture) await captureMode(capture);
else compare();
