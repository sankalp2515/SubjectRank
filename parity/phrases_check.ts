/**
 * Every feature the promoted model uses must have a plain-language phrase.
 *
 * A live comparison rendered "more ft determiner than the others" under a
 * subject line, because `ft_determiner` had no entry in `PHRASES` and the
 * fallback in `describe()` printed the feature's internal name at the reader.
 * Machine vocabulary in a sentence someone is asked to judge is the same class
 * of failure as a number they are asked to trust: they cannot check either.
 *
 * A code review did not catch it and a type could not. This does: if the
 * champion uses a feature with no phrase, this exits non-zero and names it.
 *
 * Run:  npx tsx ../parity/phrases_check.ts     (from web/)
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const META = path.join(ROOT, 'web', 'model', 'champion.meta.json');
const SRC = path.join(ROOT, 'web', 'src', 'lib', 'attribution.ts');

if (!existsSync(META)) {
  console.log('no promoted champion in web/model/ — nothing to check');
  process.exit(0);
}

const meta = JSON.parse(readFileSync(META, 'utf-8')) as {
  feature_names: string[];
  excluded_features?: string[];
};

const src = readFileSync(SRC, 'utf-8');
const block = src.slice(
  src.indexOf('const PHRASES'),
  src.indexOf('function describe'),
);
const have = new Set(
  [...block.matchAll(/^ {2}(\w+):\s*\{/gm)].map((m) => m[1]),
);

const missing = meta.feature_names.filter((f) => !have.has(f));

if (missing.length) {
  console.error(
    `\x1b[31mPHRASES MISSING\x1b[0m  ${missing.length} feature(s) the champion ` +
    `uses have no entry in PHRASES, so attribution would print their internal ` +
    `names to users:\n` +
    missing.map((m) => `  - ${m}`).join('\n') +
    `\n\nAdd them to PHRASES in web/src/lib/attribution.ts.`,
  );
  process.exit(1);
}

console.log(
  `\x1b[32mPHRASES OK\x1b[0m  all ${meta.feature_names.length} features the ` +
  `champion uses have a plain-language description`,
);
