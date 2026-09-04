/**
 * Render the benchmark's markdown from a real report, or refuse.
 *
 * Same rule as `ml/scripts/write_model_card.py`: every number here is read from
 * a file a run produced. If the run has not happened, this prints what is
 * missing rather than a table with plausible figures in it — a benchmark table
 * is exactly the kind of artifact that looks authoritative regardless of whether
 * anyone measured anything.
 *
 *   node azure/bench/report.mjs            # latest report
 *   node azure/bench/report.mjs --file X   # a specific one
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

const dir = path.resolve(import.meta.dirname, 'results');
let file = opt('file');
if (!file) {
  if (!existsSync(dir)) {
    console.error(
      'No benchmark has been run.\n\n' +
      'The D-006 assumption — in-process ONNX beats a managed inference service ' +
      'for this workload — is still unmeasured. Run:\n' +
      '  node azure/bench/benchmark.mjs --target ... --target ...\n',
    );
    process.exit(1);
  }
  const files = readdirSync(dir).filter((f) => f.startsWith('bench_')).sort();
  if (!files.length) { console.error('No bench_*.json in ' + dir); process.exit(1); }
  file = path.join(dir, files[files.length - 1]);
}

const r = JSON.parse(readFileSync(file, 'utf-8'));
const byName = Object.fromEntries(r.results.map((x) => [x.target, x]));
const names = r.results.map((x) => x.target);

const L = [];
L.push('### Serving latency — measured, not assumed');
L.push('');
L.push(`Generated from \`${path.basename(file)}\` at ${r.generated_at}. ` +
       `${r.requests_per_target} requests per target at concurrency ${r.concurrency}, ` +
       `${r.lines.length} subject lines per request.`);
L.push('');
if (r.note) { L.push(`**Run note:** ${r.note}`); L.push(''); }

L.push('| target | p50 | p90 | p99 | mean | first request | errors |');
L.push('|---|---:|---:|---:|---:|---:|---:|');
for (const x of r.results) {
  L.push(`| \`${x.target}\` | ${x.p50_ms} ms | ${x.p90_ms} ms | ${x.p99_ms} ms | ` +
         `${x.mean_ms} ms | ${x.first_request_ms} ms | ${x.errors}/${x.requests} |`);
}
L.push('');
L.push(`> ${r.caveat}`);
L.push('');

if (!r.targets_agree_on_ranking) {
  L.push('**The targets did not return the same ranking for identical input.** ' +
         'That is a correctness failure and the latency numbers above are not the ' +
         'interesting part of this run.');
  L.push('');
} else if (r.results.length > 1) {
  L.push('All targets returned the same ranking for identical input, so the ' +
         'comparison above is between two implementations of one answer.');
  L.push('');
}

/* The conclusion is only written when there is something to conclude FROM. One
   target measures a thing; it does not settle a comparison. */
const hasInProcess = names.some((n) => /local|container|aca|vercel/i.test(n));
const hasEndpoint = names.some((n) => /aml|endpoint/i.test(n));

if (hasInProcess && hasEndpoint) {
  const a = r.results.find((x) => /local|container|aca|vercel/i.test(x.target));
  const b = r.results.find((x) => /aml|endpoint/i.test(x.target));
  const ratio = (b.p50_ms / a.p50_ms);
  L.push(`**Verdict.** In-process ONNX ran at ${a.p50_ms} ms p50 against the ` +
         `managed endpoint's ${b.p50_ms} ms — a factor of ${ratio.toFixed(2)}. ` +
         `D-006 assumed the in-process path would win; this run ` +
         `${ratio > 1 ? 'supports that' : 'does not support that'} on latency alone. ` +
         `Latency is not the whole decision — see the skew argument in ` +
         `\`azure/ml/score.py\`, which no benchmark can measure.`);
} else {
  L.push('**No verdict yet.** This run measured ' +
         (hasEndpoint ? 'only the managed endpoint' : 'only the in-process path') +
         ', so it cannot settle D-006. Both a `--target` for the app and a ' +
         '`--target` for an Azure ML managed online endpoint have to be in the ' +
         'same run before there is a comparison to report.');
}
L.push('');

console.log(L.join('\n'));
