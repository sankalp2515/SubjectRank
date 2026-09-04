/**
 * TypeScript implementation of the SubjectRank feature specification.
 *
 * This is the SERVING-side twin of ml/subjectrank/features.py. Neither is the
 * reference -- docs/FEATURES.md is. When the two disagree, the parity suite fails
 * and the question is which one violated the spec.
 *
 * Every lexicon here comes from ./generated/lexicons.ts, which is projected from
 * shared/lexicons/*.json by ml/scripts/gen_ts_lexicons.py. There is exactly one
 * copy of every word list in the repository and CI fails if this drifts.
 */
import {
  FEATURE_NAMES,
  FEATURE_SPEC_VERSION,
  PRONOUNS,
  CURIOSITY,
  FIRST_TOKEN,
  POLARITY_SCORES,
  NEGATORS,
  NEGATION_WINDOW,
  EMOJI_RANGES,
  EMOJI_MODIFIERS,
  REGIONAL_INDICATOR,
  CATEGORY_OVERRIDES,
} from './generated/lexicons';

export { FEATURE_NAMES, FEATURE_SPEC_VERSION };

// --- 1. Normalisation ------------------------------------------------------

// docs/FEATURES.md 1.2. Written out rather than using \s, because Python's \s and
// JavaScript's \s do not agree on Unicode.
const WS = new Set<number>([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680,
  ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), // 2000..200A
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
const ZERO_WIDTH = new Set<number>([0x200b, 0x200c, 0x200d, 0xfeff]);

const setOf = (xs: readonly string[]) => new Set(xs);
const SECOND = setOf(PRONOUNS.second);
const FIRST_SING = setOf(PRONOUNS.first_sing);
const FIRST_PLUR = setOf(PRONOUNS.first_plur);
const THIRD = setOf(PRONOUNS.third);
const DEMONSTRATIVES = setOf(CURIOSITY.demonstratives);
const WH_WORDS = setOf(CURIOSITY.wh_words);
const INTENSIFIERS = setOf(CURIOSITY.intensifiers);
const SUPERLATIVES = setOf(CURIOSITY.superlatives);
const NEGATOR_SET = setOf(NEGATORS);
const FT = {
  wh: setOf(FIRST_TOKEN.wh),
  determiner: setOf(FIRST_TOKEN.determiner),
  pronoun: setOf(FIRST_TOKEN.pronoun),
  preposition: setOf(FIRST_TOKEN.preposition),
  auxiliary: setOf(FIRST_TOKEN.auxiliary),
  verb_common: setOf(FIRST_TOKEN.verb_common),
};
const EMOJI_MOD_SET = new Set<number>(EMOJI_MODIFIERS);

// --- 2. Character classification -------------------------------------------

const RE_LETTER = /\p{L}/u;
const RE_ND = /\p{Nd}/u;
const RE_LU = /\p{Lu}/u;
const RE_LL = /\p{Ll}/u;

/**
 * General category, with the override table taking precedence.
 *
 * CPython and Node derive category data from different Unicode Character Database
 * versions, so a code point added between them can classify differently. Pinning
 * contested code points to a shared file makes behaviour a property of the repo
 * rather than of whichever runtime is installed. docs/FEATURES.md 2.2.
 *
 * Memoising this by code point was tried and reverted. It is a pure function of
 * one code point and it is called several times per character, so a cache looked
 * obviously worthwhile - but measured over the parity corpus (184 strings x 52
 * features, 184,000 extractions) it moved throughput from 27,300/s to 28,200/s.
 * A 3% gain does not justify a change to the one file whose agreement with
 * features.py is the invariant the entire product rests on.
 */
function category(ch: string): string {
  const ov = CATEGORY_OVERRIDES[String(ch.codePointAt(0))];
  if (ov !== undefined) return ov;
  if (RE_LU.test(ch)) return 'Lu';
  if (RE_LL.test(ch)) return 'Ll';
  if (RE_LETTER.test(ch)) return 'Lo';
  if (RE_ND.test(ch)) return 'Nd';
  return 'Zz';
}

const isLetter = (ch: string) => category(ch).startsWith('L');
const isNd = (ch: string) => category(ch) === 'Nd';

/** NFC -> collapse whitespace runs to U+0020 -> trim. docs/FEATURES.md 1. */
export function normalise(raw: string): string {
  const nfc = raw.normalize('NFC');
  let out = '';
  let inWs = false;
  for (const ch of nfc) {
    if (WS.has(ch.codePointAt(0)!)) {
      if (!inWs) out += ' ';
      inWs = true;
    } else {
      out += ch;
      inWs = false;
    }
  }
  let a = 0;
  let b = out.length;
  while (a < b && out[a] === ' ') a++;
  while (b > a && out[b - 1] === ' ') b--;
  return out.slice(a, b);
}

const APOSTROPHES = new Set(["'", '’']);

/** Maximal runs of letter / Nd digit / apostrophe. docs/FEATURES.md 2.1. */
export function tokenise(text: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (isLetter(ch) || isNd(ch) || APOSTROPHES.has(ch)) cur += ch;
    else {
      if (cur) tokens.push(cur);
      cur = '';
    }
  }
  if (cur) tokens.push(cur);

  const cleaned: string[] = [];
  for (let t of tokens) {
    let s = 0;
    let e = Array.from(t).length;
    const arr = Array.from(t);
    while (s < e && APOSTROPHES.has(arr[s])) s++;
    while (e > s && APOSTROPHES.has(arr[e - 1])) e--;
    const stripped = arr.slice(s, e).join('');
    if (stripped) cleaned.push(stripped);
  }
  return cleaned;
}

export const fold = (t: string) => t.toLowerCase().replace(/’/g, "'");

// --- 3. Emoji --------------------------------------------------------------

function isEmojiChar(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  const [rLo, rHi] = REGIONAL_INDICATOR;
  if (cp >= rLo && cp <= rHi) return true;
  for (const [a, b] of EMOJI_RANGES) if (cp >= a && cp <= b) return true;
  return false;
}
const isRI = (ch: string) => {
  const cp = ch.codePointAt(0)!;
  return cp >= REGIONAL_INDICATOR[0] && cp <= REGIONAL_INDICATOR[1];
};
const isClusterMember = (ch: string) =>
  isEmojiChar(ch) || EMOJI_MOD_SET.has(ch.codePointAt(0)!);

/** Emoji cluster spans over the code-point array. docs/FEATURES.md 3.6. */
function emojiClusters(chars: string[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const n = chars.length;
  let i = 0;
  while (i < n) {
    if (!isEmojiChar(chars[i])) {
      i++;
      continue;
    }
    const start = i;
    if (isRI(chars[i]) && i + 1 < n && isRI(chars[i + 1])) {
      i += 2; // regional indicator pair == one flag
    } else {
      i++;
      for (;;) {
        const cp = i < n ? chars[i].codePointAt(0)! : -1;
        if (i < n && EMOJI_MOD_SET.has(cp) && chars[i] !== '‍') {
          i++;
          continue;
        }
        if (i + 1 < n && chars[i] === '‍' && isEmojiChar(chars[i + 1])) {
          i += 2;
          continue;
        }
        break;
      }
    }
    spans.push([start, i]);
  }
  return spans;
}

// --- 4. Syllables ----------------------------------------------------------

const ASCII_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const VOWELS = new Set('aeiouy');

/** docs/FEATURES.md 3.8. Crude, and identical to the Python side, which is the
 * property that actually matters. */
export function syllables(tokenLower: string): number {
  let letters = '';
  for (const c of tokenLower) if (ASCII_LOWER.includes(c)) letters += c;
  if (!letters) return 1;
  let count = 0;
  let prevVowel = false;
  for (const c of letters) {
    const v = VOWELS.has(c);
    if (v && !prevVowel) count++;
    prevVowel = v;
  }
  if (letters.endsWith('e') && !letters.endsWith('le') && count > 1) count--;
  return Math.max(count, 1);
}

// --- 5. Extraction ---------------------------------------------------------

const DIGIT_VALUE = (ch: string): number => {
  const cp = ch.codePointAt(0)!;
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30;
  // Non-ASCII Nd blocks are contiguous and zero-aligned by Unicode rule, so the
  // offset from the block's zero is the value. Walk back to the first code point
  // that is NOT Nd; that is block-zero minus one.
  //
  // The bound is `>=`, not `>`. With `>` the loop stopped one short, so a digit of
  // value 9 never found the block boundary and fell through to 0: Arabic-Indic ٩
  // and Devanagari ९ both extracted as 0 while Python's unicodedata.digit()
  // returned 9. The parity corpus contained no non-ASCII digit with value 9, so
  // the suite could not see it - fixed there too.
  for (let base = cp; base >= cp - 10; base--) {
    if (!/\p{Nd}/u.test(String.fromCodePoint(base))) return cp - base - 1;
  }
  return 0;
};

export function extract(raw: string): number[] {
  const text = normalise(raw);
  const allChars = Array.from(text);
  const chars = allChars.filter((c) => !ZERO_WIDTH.has(c.codePointAt(0)!));
  const C = chars.length;

  const tokens = tokenise(text);
  const lower = tokens.map(fold);
  const L = tokens.length;
  const tokLen = (t: string) => Array.from(t).length;

  const f: Record<string, number> = {};
  const syl = lower.map(syllables);

  // 3.1 length and shape. Array.from, never .length -- .length is UTF-16 units
  // and would count an emoji as 2. This is the single likeliest divergence.
  f.char_count = C;
  f.word_count = L;
  f.mean_word_len = L ? tokens.reduce((a, t) => a + tokLen(t), 0) / L : 0;
  f.max_word_len = L ? Math.max(...tokens.map(tokLen)) : 0;
  f.long_word_ratio = L ? syl.filter((s) => s >= 3).length / L : 0;

  // 3.2 case
  const cats = chars.map(category);
  const nUpper = cats.filter((c) => c === 'Lu').length;
  const nCased = cats.filter((c) => c === 'Lu' || c === 'Ll').length;
  f.upper_char_ratio = nCased ? nUpper / nCased : 0;

  let allcaps = 0;
  for (const t of tokens) {
    const cased = Array.from(t).filter((c) => {
      const k = category(c);
      return k === 'Lu' || k === 'Ll';
    });
    if (cased.length >= 2 && cased.every((c) => category(c) === 'Lu')) allcaps++;
  }
  f.allcaps_word_count = allcaps;
  f.title_case_ratio = L
    ? tokens.filter((t) => t && category(Array.from(t)[0]) === 'Lu').length / L
    : 0;

  // 3.3 digits
  const nDigits = cats.filter((c) => c === 'Nd').length;
  f.has_digit = nDigits ? 1 : 0;
  f.digit_count = nDigits;
  const firstAllDigit = L > 0 && Array.from(tokens[0]).every(isNd);
  f.starts_with_digit = firstAllDigit ? 1 : 0;
  if (firstAllDigit) {
    let val = 0;
    for (const c of Array.from(tokens[0])) {
      val = val * 10 + DIGIT_VALUE(c);
      if (val > 1000) break;
    }
    f.leading_number_magnitude = Math.min(val, 1000);
  } else f.leading_number_magnitude = 0;

  // 3.4 punctuation
  const countOf = (needle: string) => allChars.filter((c) => c === needle).length;
  f.has_question = text.includes('?') || text.includes('？') ? 1 : 0;
  const nExcl = countOf('!') + countOf('！');
  f.has_exclamation = nExcl ? 1 : 0;
  f.exclamation_count = nExcl;
  f.has_ellipsis = text.includes('…') || text.includes('...') ? 1 : 0;
  f.comma_count = countOf(',') + countOf('，');
  f.has_colon = text.includes(':') ? 1 : 0;
  f.has_quote = Array.from('"\'‘’“”').some((c) => text.includes(c)) ? 1 : 0;
  f.has_dash = Array.from('-–—').some((c) => text.includes(c)) ? 1 : 0;

  // Scan right-to-left past trailing emoji and zero-width so "Really?? 🎉" still
  // counts as ending in a question mark.
  const tail = allChars.slice();
  while (
    tail.length &&
    (isClusterMember(tail[tail.length - 1]) ||
      ZERO_WIDTH.has(tail[tail.length - 1].codePointAt(0)!) ||
      tail[tail.length - 1] === ' ')
  )
    tail.pop();
  const last = tail.length ? tail[tail.length - 1] : '';
  f.ends_question = last === '?' || last === '？' ? 1 : 0;
  f.ends_exclamation = last === '!' || last === '！' ? 1 : 0;
  const trimmed = tail.join('');
  f.ends_ellipsis = trimmed.endsWith('…') || trimmed.endsWith('...') ? 1 : 0;

  // 3.5 lexicon counts
  const countIn = (s: Set<string>) => lower.filter((t) => s.has(t)).length;
  f.second_person_count = countIn(SECOND);
  f.first_person_sing_count = countIn(FIRST_SING);
  f.first_person_plur_count = countIn(FIRST_PLUR);
  f.third_person_count = countIn(THIRD);
  f.demonstrative_count = countIn(DEMONSTRATIVES);
  f.wh_word_count = countIn(WH_WORDS);
  f.intensifier_count = countIn(INTENSIFIERS);
  f.superlative_count = countIn(SUPERLATIVES);
  f.leading_demonstrative = lower.slice(0, 3).some((t) => DEMONSTRATIVES.has(t)) ? 1 : 0;

  // 3.6 emoji
  const spans = emojiClusters(allChars);
  f.has_emoji = spans.length ? 1 : 0;
  f.emoji_count = spans.length;
  f.emoji_leading = spans.length && spans[0][0] === 0 ? 1 : 0;
  f.emoji_trailing =
    spans.length && spans[spans.length - 1][1] === allChars.length ? 1 : 0;

  // 3.7 polarity
  let polSum = 0;
  let polAbs = 0;
  let posN = 0;
  let negN = 0;
  for (let i = 0; i < lower.length; i++) {
    const raw0 = POLARITY_SCORES[lower[i]];
    if (raw0 === undefined) continue;
    let score = raw0;
    const window = lower.slice(Math.max(0, i - NEGATION_WINDOW), i);
    if (window.some((w) => NEGATOR_SET.has(w))) score = -score;
    polSum += score;
    polAbs += Math.abs(score);
    if (score > 0) posN++;
    else if (score < 0) negN++;
  }
  f.polarity_sum = polSum;
  f.polarity_abs_sum = polAbs;
  f.polarity_pos_count = posN;
  f.polarity_neg_count = negN;

  // 3.8 readability
  const totalSyl = syl.reduce((a, b) => a + b, 0);
  f.syllable_count = totalSyl;
  f.mean_syllables_per_word = L ? totalSyl / L : 0;
  if (L) {
    let sentences = 0;
    let prevTerm = false;
    for (const c of allChars) {
      const term = c === '.' || c === '!' || c === '?';
      if (term && !prevTerm) sentences++;
      prevTerm = term;
    }
    sentences = Math.max(1, sentences);
    const flesch = 206.835 - 1.015 * (L / sentences) - 84.6 * (totalSyl / L);
    f.flesch_reading_ease = Math.max(-100, Math.min(150, flesch));
  } else f.flesch_reading_ease = 0;

  // 3.9 first-token class
  for (const k of ['determiner', 'wh', 'pronoun', 'preposition', 'auxiliary',
    'numeral', 'verb_common', 'other']) f['ft_' + k] = 0;
  if (L) {
    const t0 = lower[0];
    let cls: string;
    if (firstAllDigit) cls = 'numeral';
    else if (FT.wh.has(t0)) cls = 'wh';
    else if (FT.determiner.has(t0)) cls = 'determiner';
    else if (FT.pronoun.has(t0)) cls = 'pronoun';
    else if (FT.auxiliary.has(t0)) cls = 'auxiliary';
    else if (FT.preposition.has(t0)) cls = 'preposition';
    else if (FT.verb_common.has(t0)) cls = 'verb_common';
    else cls = 'other';
    f['ft_' + cls] = 1;
  }

  // 3.10 script
  f.non_ascii_ratio = C ? chars.filter((c) => c.codePointAt(0)! > 127).length / C : 0;

  const vec = FEATURE_NAMES.map((n) => {
    const v = f[n];
    if (v === undefined) throw new Error(`feature ${n} not computed`);
    if (!Number.isFinite(v)) throw new Error(`non-finite feature ${n} for ${raw}`);
    return v;
  });
  return vec;
}
