/**
 * Put a number on D-006.
 *
 * D-006 chose in-process ONNX inside the Next.js function over a separate Python
 * inference service, on cold-start and cost grounds. That was reasoning, not
 * measurement, and it has been sitting in DECISIONS.md unmeasured since. This
 * harness measures both paths under the same load and writes a report; the
 * decision text is generated from that report by `report.mjs` and refuses to
 * exist without it.
 *
 * Two honesty rules are built into this file:
 *
 *  1. **It never invents a number.** A target that errors is recorded as errors,
 *     not dropped so the surviving samples look clean.
 *  2. **"Cold start" is labelled by what was actually done, not by what we wish
 *     it meant.** Whether a first request is genuinely cold depends on each
 *     target's scaling configuration, which this harness records and cannot
 *     control. A Container App at minReplicas=0 that has been idle is cold; a
 *     managed online endpoint at instance_count=1 is not. Comparing those two
 *     first-request numbers as though they were the same measurement would be
 *     the exact kind of quiet overstatement this project exists to avoid.
 *
 * Usage:
 *   node azure/bench/benchmark.mjs \
 *     --target local=http://localhost:3210 \
 *     --target aca=https://<app>.azurecontainerapps.io  *     --target api=https://<api>.azurecontainerapps.io \
 *     --target amlep=https://<endpoint>.inference.ml.azure.com/score --key <key> \
 *     --n 200 --concurrency 4
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const targets = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--target') {
    const [name, ...rest] = args[i + 1].split('=');
    targets.push({ name, url: rest.join('=') });
  }
}
if (!targets.length) {
  console.error('Give at least one --target name=url. See the header of this file.');
  process.exit(2);
}

const N = Number(opt('n', 200));
const CONCURRENCY = Number(opt('concurrency', 4));
const KEY = opt('key', process.env.AML_ENDPOINT_KEY);
const OUT = opt('out', path.resolve(import.meta.dirname, 'results'));
const NOTE = opt('note', '');

/* Four lines, because that is the middle of the 2–5 the product accepts and it
   makes 12 ordered pairs per request — enough that inference is a real part of
   the work rather than lost in HTTP overhead. */
const LINES = [
  'Why your best customers leave',
  'The one chart that explains your churn',
  'We looked at 400 churn surveys. Here is what we found.',
  'This is what nobody tells you about churn',
];

/** The three paths speak different dialects; normalise so the comparison is fair.
 *
 * A target whose name starts with `api` is the FastAPI service and takes
 * /v1/compare. It was added after this harness was written, and it matters more
 * than the other two: D-006 chose in-process ONNX over "a separate Python
 * inference service" on reasoning alone, and that service now actually exists.
 * Benchmarking the Next route against a managed endpoint only ever compared the
 * chosen design against the one nobody proposed.
 */
function requestFor(target) {
  const isAml = /inference\.ml\.azure\.com/.test(target.url) || target.name.startsWith('aml');
  const isApi = !isAml && target.name.startsWith('api');
  const base = target.url.replace(/\/$/, '');
  const url = isAml ? target.url : `${base}${isApi ? '/v1/compare' : '/api/rank'}`;
  const headers = { 'content-type': 'application/json' };
  if (isAml && KEY) headers.authorization = `Bearer ${KEY}`;
  return { url, headers, body: JSON.stringify({ lines: LINES }), isAml };
}

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

async function once(req) {
  const t0 = performance.now();
  try {
    const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body });
    const text = await res.text();
    const ms = performance.now() - t0;
    if (!res.ok) return { ms, ok: false, status: res.status, body: text.slice(0, 200) };
    let ranked = null;
    try {
      const j = JSON.parse(text);
      const lines = j.comparison?.lines ?? j.lines ?? null;
      // Record the ORDER each path returns. A latency comparison between two
      // services that disagree about the answer is not a comparison worth having.
      ranked = lines ? lines.map((l) => l.index) : null;
    } catch { /* body recorded below */ }
    return { ms, ok: true, status: res.status, ranked, bytes: text.length };
  } catch (e) {
    return { ms: performance.now() - t0, ok: false, status: 0, body: String(e).slice(0, 200) };
  }
}

async function measure(target) {
  const req = requestFor(target);
  process.stdout.write(`\n${target.name}  ${req.url}\n`);

  // First request, before any warmup. Whether this is a true cold start depends
  // on the target's scaling config — recorded, not assumed.
  const first = await once(req);
  process.stdout.write(`  first request: ${first.ms.toFixed(1)} ms  (ok=${first.ok})\n`);
  if (!first.ok) process.stdout.write(`    ${first.status} ${first.body ?? ''}\n`);

  // Warm up, then measure. Warmup samples are discarded explicitly rather than
  // quietly folded in.
  for (let i = 0; i < 10; i++) await once(req);

  const samples = [];
  let inFlight = 0, issued = 0;
  await new Promise((resolve) => {
    const pump = () => {
      while (inFlight < CONCURRENCY && issued < N) {
        issued++; inFlight++;
        once(req).then((r) => {
          samples.push(r);
          inFlight--;
          if (samples.length === N) resolve(); else pump();
        });
      }
    };
    pump();
  });

  const ok = samples.filter((s) => s.ok);
  const lat = ok.map((s) => s.ms).sort((a, b) => a - b);
  const orders = new Set(ok.map((s) => JSON.stringify(s.ranked)));

  const stats = {
    target: target.name,
    url: req.url,
    requests: N,
    concurrency: CONCURRENCY,
    errors: samples.length - ok.length,
    first_request_ms: Number(first.ms.toFixed(2)),
    first_request_ok: first.ok,
    p50_ms: lat.length ? Number(quantile(lat, 0.5).toFixed(2)) : null,
    p90_ms: lat.length ? Number(quantile(lat, 0.9).toFixed(2)) : null,
    p99_ms: lat.length ? Number(quantile(lat, 0.99).toFixed(2)) : null,
    mean_ms: lat.length ? Number((lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(2)) : null,
    min_ms: lat.length ? Number(lat[0].toFixed(2)) : null,
    max_ms: lat.length ? Number(lat[lat.length - 1].toFixed(2)) : null,
    response_bytes: ok.length ? ok[0].bytes : null,
    distinct_orders_returned: orders.size,
    ranking: ok.length ? ok[0].ranked : null,
    error_samples: samples.filter((s) => !s.ok).slice(0, 3)
      .map((s) => ({ status: s.status, body: s.body })),
  };

  process.stdout.write(
    `  warm p50 ${stats.p50_ms} ms · p90 ${stats.p90_ms} ms · p99 ${stats.p99_ms} ms` +
    ` · errors ${stats.errors}/${N}\n`,
  );
  if (stats.distinct_orders_returned > 1) {
    process.stdout.write(
      `  WARNING: this target returned ${stats.distinct_orders_returned} different` +
      ` orderings for identical input. Latency is not the problem here.\n`,
    );
  }
  return stats;
}

const results = [];
for (const t of targets) results.push(await measure(t));

/* Cross-target agreement. If two serving paths rank the same four lines
   differently, the benchmark has found something far more important than a
   latency difference, and the report has to lead with it. */
const rankings = results.filter((r) => r.ranking).map((r) => JSON.stringify(r.ranking));
const agree = new Set(rankings).size <= 1;

const report = {
  generated_at: new Date().toISOString(),
  note: NOTE,
  lines: LINES,
  requests_per_target: N,
  concurrency: CONCURRENCY,
  targets_agree_on_ranking: agree,
  caveat:
    'first_request_ms is only a cold start if that target was actually scaled to ' +
    'zero or freshly deployed. Container Apps at minReplicas=0 scales to zero; an ' +
    'Azure ML managed online deployment at instance_count=1 does not. Record which ' +
    'was true in `note` before quoting these side by side.',
  results,
};

mkdirSync(OUT, { recursive: true });
const stamp = report.generated_at.replace(/[:.]/g, '-');
const file = path.join(OUT, `bench_${stamp}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));

console.log(`\nwrote ${file}`);
if (!agree) {
  console.error('\nTARGETS DISAGREE ON THE RANKING. Fix that before reading the latency numbers.');
  process.exit(1);
}
