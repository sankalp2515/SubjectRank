/**
 * Turn a model's feature weights into annotation a person can check.
 *
 * Three rules govern everything here, and all three come from the honesty mandate:
 *
 * 1. **Never speak about a feature the model does not use.** Features dropped for
 *    insufficient training support (D-012) get the explicit "not measured" state,
 *    never silence and never an invented opinion.
 * 2. **The factual clause describes the DIFFERENCE; the verdict describes the
 *    CONTRIBUTION.** These are different signs and conflating them was a real bug:
 *    `contribution = coef x (mine - theirs)`, so on a feature with a positive
 *    coefficient a *longer* line produced a positive contribution and was described
 *    as "shorter than the others you gave us" — a false statement printed next to
 *    the character count that disproved it. Wording is now selected by
 *    `mine - theirs` alone; `kind` is selected by the contribution.
 * 3. **A mark is only ever drawn on something that is actually there.** A note may
 *    legitimately say "no second person"; a *mark* pointing at a second-person word
 *    may not appear on a line that has none.
 */
import { CURIOSITY, PRONOUNS } from './generated/lexicons';
import { usesEmojiFeatures } from './feature-groups';
import { fold } from './features';
import type { ModelMeta } from './model';

export type NoteKind = 'helps' | 'hurts' | 'no-effect' | 'not-measured';

export type Note = {
  kind: NoteKind;
  /** Plain language. Never "inference", never "the pairwise ranker". */
  text: string;
  contribution: number;
  feature: string;
  /**
   * The two numbers the sentence is actually about: this line's value, and the
   * mean over the other lines in this comparison.
   *
   * They are carried through to the interface on purpose. A reader cannot judge
   * whether "longer than the others you gave us" is fair without seeing both
   * sides of the comparison it names, and a claim they cannot check is
   * decoration. Undefined for the no-attribution note, which is about nothing.
   */
  mine?: number;
  theirs?: number;
};

/**
 * `feature` is what lets the interface tie a mark on the text to the sentence
 * that justifies it. Matching on `label` instead worked until two features
 * produced the same label, and a highlight that lights up next to the wrong
 * sentence is a claim about the reader's words that nothing supports.
 */
export type Mark = {
  start: number; end: number;
  kind: 'helps' | 'hurts';
  label: string;
  feature: string;
};

const SECOND = new Set(PRONOUNS.second);
const DEMONSTRATIVES = new Set(CURIOSITY.demonstratives);

/**
 * Wording keyed on the direction of the DIFFERENCE, not on the verdict.
 *
 * `more`  — this line has more of the feature than the others
 * `less`  — this line has less of it
 *
 * Phrasing points at the training data rather than asserting a universal truth,
 * because the domain gap is real and the copy should carry it (D-011).
 */
type Phrase = { more: string; less: string; unit?: (v: number) => string };

const PHRASES: Record<string, Phrase> = {
  char_count: {
    more: 'longer than the others you gave us',
    less: 'shorter than the others you gave us',
    unit: (v) => `${Math.round(v)} characters`,
  },
  word_count: { more: 'more words than the others', less: 'fewer words than the others' },
  mean_word_len: { more: 'longer words', less: 'shorter words' },
  max_word_len: { more: 'contains a longer word', less: 'no long words' },
  long_word_ratio: { more: 'several long words', less: 'few long words' },
  second_person_count: {
    more: 'speaks to the reader directly',
    less: 'less second person than the others',
  },
  first_person_sing_count: { more: 'first person singular', less: 'no first person' },
  first_person_plur_count: { more: 'speaks as "we"', less: 'does not speak as "we"' },
  third_person_count: { more: 'third person', less: 'no third person' },
  wh_word_count: { more: 'opens a question', less: 'no question framing' },
  demonstrative_count: { more: 'demonstratives', less: 'no demonstratives' },
  leading_demonstrative: {
    more: 'opens on a demonstrative, which leaves a gap to close',
    less: 'does not open on a demonstrative',
  },
  has_question: { more: 'contains a question mark', less: 'no question mark' },
  ends_question: { more: 'ends on a question mark', less: 'does not end on a question' },
  has_exclamation: { more: 'contains an exclamation mark', less: 'no exclamation mark' },
  exclamation_count: { more: 'more exclamation marks', less: 'fewer exclamation marks' },
  ends_exclamation: { more: 'ends on an exclamation mark', less: 'does not end on an exclamation' },
  has_ellipsis: { more: 'trails off', less: 'does not trail off' },
  ends_ellipsis: { more: 'ends on an ellipsis', less: 'does not end on an ellipsis' },
  has_digit: { more: 'contains a number', less: 'no number' },
  digit_count: { more: 'more digits', less: 'fewer digits' },
  starts_with_digit: { more: 'opens on a number', less: 'does not open on a number' },
  leading_number_magnitude: { more: 'opens on a larger number', less: 'opens on a smaller number' },
  upper_char_ratio: { more: 'heavier capitalisation', less: 'lighter capitalisation' },
  allcaps_word_count: { more: 'words in full capitals', less: 'no words in full capitals' },
  title_case_ratio: { more: 'more title case', less: 'less title case' },
  superlative_count: { more: 'superlatives', less: 'no superlatives' },
  intensifier_count: { more: 'intensifiers', less: 'no intensifiers' },
  polarity_sum: { more: 'more positive wording', less: 'more negative wording' },
  polarity_abs_sum: { more: 'more emotive wording', less: 'flatter wording' },
  polarity_pos_count: { more: 'more positive words', less: 'fewer positive words' },
  polarity_neg_count: { more: 'more negative words', less: 'fewer negative words' },
  flesch_reading_ease: { more: 'reads more easily', less: 'harder to read' },
  syllable_count: { more: 'more syllables', less: 'fewer syllables' },
  mean_syllables_per_word: { more: 'longer words', less: 'shorter words' },
  has_colon: { more: 'a colon splits it into a label and a payload', less: 'no colon' },
  comma_count: { more: 'more commas', less: 'fewer commas' },
  has_quote: { more: 'contains a quotation', less: 'no quotation' },
  has_dash: { more: 'contains a dash', less: 'no dash' },
  non_ascii_ratio: { more: 'more non-Latin characters', less: 'fewer non-Latin characters' },

  /*
   * First-token class (FEATURES.md 3.9, D-008). One-hot: exactly one of these is
   * 1 for any line, so `more` means "this line opens that way and the others
   * mostly do not".
   *
   * These eight were missing, and the fallback in `describe` turned the feature
   * name into the sentence: a live comparison rendered
   * "more ft determiner than the others" underneath a subject line. Machine
   * vocabulary in a sentence a person is asked to judge is the same failure as a
   * number they are asked to trust -- they cannot check either. Found by looking
   * at a rendered comparison, not by reading this file.
   */
  ft_wh: {
    more: 'opens on a question word',
    less: 'does not open on a question word',
  },
  ft_determiner: {
    more: 'opens on "the", "this" or "a"',
    less: 'does not open on "the", "this" or "a"',
  },
  ft_pronoun: { more: 'opens on a pronoun', less: 'does not open on a pronoun' },
  ft_preposition: {
    more: 'opens on a preposition',
    less: 'does not open on a preposition',
  },
  ft_auxiliary: {
    more: 'opens on "is", "can" or another auxiliary',
    less: 'does not open on an auxiliary',
  },
  ft_numeral: { more: 'opens on a number', less: 'does not open on a number' },
  ft_verb_common: {
    more: 'opens on a verb, like "watch" or "meet"',
    less: 'does not open on a verb',
  },
  ft_other: {
    more: 'opens on a word outside the common openers',
    less: 'opens on one of the common openers',
  },
};

function describe(feature: string, delta: number, value: number): string {
  const p = PHRASES[feature];
  if (!p) {
    // A feature with no phrase used to render its own name at the reader:
    // "more ft determiner than the others". The fallback now says only what is
    // certainly true -- that this property differs -- and never pretends the
    // internal name is English. `npm run phrases:check` fails the build if a
    // model ships a feature that lands here.
    return delta > 0
      ? 'more of a property we have not written a plain description for yet'
      : 'less of a property we have not written a plain description for yet';
  }
  const base = delta > 0 ? p.more : p.less;
  return p.unit ? `${p.unit(value)} — ${base}` : base;
}

/**
 * Exact per-feature contribution for a linear model, measured against the mean of
 * the OTHER lines in this comparison — because that is the question the user
 * actually asked: why this one rather than those.
 */
export function notesFor(
  meta: ModelMeta,
  features: Record<string, number>,
  otherFeatures: Array<Record<string, number>>,
  limit = 3,
): Note[] {
  const notes: Note[] = [];

  if (meta.coefficients && meta.scale) {
    meta.feature_names.forEach((name, i) => {
      const coef = meta.coefficients![i];
      const rawScale = meta.scale![i];
      // A zero scale means the feature had no variance in training. Inventing a
      // denominator would manufacture a contribution out of nothing, so skip it.
      if (!rawScale) return;

      const mine = features[name] ?? 0;
      const theirs = otherFeatures.length
        ? otherFeatures.reduce((a, f) => a + (f[name] ?? 0), 0) / otherFeatures.length
        : 0;
      const delta = mine - theirs;
      if (Math.abs(delta) < 1e-12) return;

      const contribution = (coef * delta) / rawScale;
      if (Math.abs(contribution) < 1e-9) return;

      notes.push({
        // Wording from the difference; verdict from the contribution. They are
        // different signs and treating them as one was a real bug.
        kind: contribution > 0 ? 'helps' : 'hurts',
        text: describe(name, delta, mine),
        contribution,
        feature: name,
        mine,
        theirs,
      });
    });
  } else {
    // No exact attribution available (a non-linear champion). Say so rather than
    // rendering an empty column, which reads as "nothing to say".
    notes.push({
      kind: 'no-effect',
      feature: '__no_attribution__',
      contribution: 0,
      text:
        'This model does not expose an exact per-feature breakdown, so there is ' +
        'no reasoning to show for this line.',
    });
  }

  notes.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const top = notes.slice(0, limit);

  // The fourth state, and the one that matters most. Triggered by the model not
  // *using* the emoji features - not by how the artifact happens to spell
  // exclusion - so an artifact that simply omits them still produces the note.
  const usesEmoji = usesEmojiFeatures(meta.feature_names);
  const lineHasEmoji = (features.has_emoji ?? 0) > 0 || (features.emoji_count ?? 0) > 0;

  if (!usesEmoji && lineHasEmoji) {
    top.push({
      kind: 'not-measured',
      feature: 'has_emoji',
      contribution: 0,
      text:
        'Nothing to say about the emoji — it appears in almost none of the ' +
        'headlines this model learned from, so any opinion would be made up.',
    });
  }

  return top;
}

// --- marks ------------------------------------------------------------------

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);
const APOSTROPHES = new Set(["'", '’']);
const RE_LETTER = /\p{L}/u;
const RE_ND = /\p{Nd}/u;

/**
 * Token spans with UTF-16 offsets.
 *
 * Replaces an earlier `indexOf` search, which matched substrings: on
 * "Where you keep your youth" it marked the "you" inside "your" and inside
 * "youth" and labelled both "second person". A mark is presented to the reader as
 * proof drawn on the text, so it has to point at a real token.
 */
function tokenSpans(text: string): Array<{ tok: string; start: number; end: number }> {
  const spans: Array<{ tok: string; start: number; end: number }> = [];
  let start = -1;
  let i = 0;
  for (const ch of text) {
    const isTok = RE_LETTER.test(ch) || RE_ND.test(ch) || APOSTROPHES.has(ch);
    if (isTok && start < 0) start = i;
    if (!isTok && start >= 0) {
      spans.push({ tok: text.slice(start, i), start, end: i });
      start = -1;
    }
    i += ch.length;
  }
  if (start >= 0) spans.push({ tok: text.slice(start), start, end: i });

  return spans
    .map((s) => {
      let { start: a, end: b } = s;
      while (a < b && APOSTROPHES.has(text[a])) a++;
      while (b > a && APOSTROPHES.has(text[b - 1])) b--;
      return { tok: text.slice(a, b), start: a, end: b };
    })
    .filter((s) => s.tok.length > 0);
}

/** UTF-16 span of the last character that is not trailing emoji/zero-width/space. */
function terminalSpan(text: string, isEmojiish: (cp: number) => boolean): { start: number; end: number } | null {
  const cps = Array.from(text);
  let end = text.length;
  for (let k = cps.length - 1; k >= 0; k--) {
    const ch = cps[k];
    const cp = ch.codePointAt(0)!;
    if (isEmojiish(cp) || ZERO_WIDTH.has(cp) || ch === ' ') {
      end -= ch.length;
      continue;
    }
    // Whole code point, never half a surrogate pair.
    return { start: end - ch.length, end };
  }
  return null;
}

/**
 * Character spans to annotate on the line itself. Only for features the model
 * actually uses, and only where the line genuinely exercises them.
 *
 * `text` MUST be the same string the card renders. model.ts passes the normalised
 * form, which is also what the features were computed on, so offsets, the rendered
 * glyphs and the reported character count all refer to one string.
 */
export function marksFor(
  text: string,
  notes: Note[],
  meta: ModelMeta,
  features: Record<string, number>,
): Mark[] {
  const used = new Set(meta.feature_names);
  const byFeature = new Map(notes.map((n) => [n.feature, n]));
  const marks: Mark[] = [];

  const active = (f: string): 'helps' | 'hurts' | null => {
    if (!used.has(f)) return null;
    const n = byFeature.get(f);
    if (!n) return null;
    return n.kind === 'helps' || n.kind === 'hurts' ? n.kind : null;
  };

  const spans = tokenSpans(text);

  const secondKind = active('second_person_count');
  if (secondKind && (features.second_person_count ?? 0) > 0) {
    for (const s of spans) {
      if (SECOND.has(fold(s.tok))) {
        marks.push({
          start: s.start, end: s.end, kind: secondKind,
          label: `“${s.tok}” — second person`,
          feature: 'second_person_count',
        });
      }
    }
  }

  const demoFeature = active('leading_demonstrative')
    ? 'leading_demonstrative'
    : active('demonstrative_count') ? 'demonstrative_count' : null;
  const demoKind = demoFeature ? active(demoFeature) : null;
  if (demoFeature && demoKind && (features.leading_demonstrative ?? 0) > 0) {
    const first = spans[0];
    if (first && DEMONSTRATIVES.has(fold(first.tok))) {
      marks.push({
        start: first.start, end: first.end, kind: demoKind,
        label: 'demonstrative', feature: demoFeature,
      });
    }
  }

  // Terminal punctuation. Guarded on the FEATURE VALUE, not merely on a note
  // existing: a note can legitimately say "does not end on a question", and
  // ringing the final letter of such a line and calling it terminal punctuation
  // is a fabrication drawn directly onto the user's own words.
  const isEmojiish = (cp: number) => {
    // Cheap superset: anything above the BMP plus the common symbol blocks. Only
    // used to skip trailing decoration, never to claim anything about emoji.
    return cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff)
      || cp === 0xfe0f || cp === 0xfe0e;
  };
  for (const f of ['ends_question', 'ends_exclamation', 'ends_ellipsis'] as const) {
    const kind = active(f);
    if (!kind || (features[f] ?? 0) <= 0) continue;
    const span = terminalSpan(text, isEmojiish);
    if (!span) continue;
    if (f === 'ends_ellipsis' && text.slice(0, span.end).endsWith('...')) {
      marks.push({
        start: span.end - 3, end: span.end, kind,
        label: 'terminal punctuation', feature: f,
      });
    } else {
      marks.push({ ...span, kind, label: 'terminal punctuation', feature: f });
    }
    break; // at most one terminal mark
  }

  // Drop overlaps against the LAST KEPT mark. Comparing against the previous
  // element of the pre-filter array let a mark survive by being compared to one
  // that had itself been dropped, and two overlapping marks made the renderer
  // duplicate characters.
  const sorted = marks.sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: Mark[] = [];
  for (const m of sorted) {
    if (!kept.length || m.start >= kept[kept.length - 1].end) kept.push(m);
  }
  return kept;
}
