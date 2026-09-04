/**
 * FABRICATED DATA. A design harness, and nothing else.
 *
 * No model is deployed, so the comparison surface cannot be rendered from a real
 * ranking - and it has to be looked at, because reading the code does not catch
 * what looking catches.
 *
 * Three rules keep this from becoming the thing this product argues against:
 *
 *   1. It is reachable only from /dev/preview, which returns 404 in production.
 *   2. Nothing imports it except that route. The landing page's example comes
 *      from `lib/generated/worked_example.json`, which is computed by the real
 *      model or says "untrained" - never from here.
 *   3. The page renders a banner saying the numbers are invented.
 *
 * Delete it once a champion exists and the worked example is real.
 */
import type { Comparison } from '@/lib/model';

export const TRAINING_MEDIAN_CHARS = 68;
export const EXCLUDED = ['has_emoji', 'emoji_count', 'emoji_leading', 'emoji_trailing'];

/* Scores chosen to exercise the case the whole design turns on: the top two are
   within the too-close threshold of each other and both separable from the third,
   so two lines share a placing RANGE while the third gets an exact placing. */
export const FIXTURE: Comparison = {
  modelVersion: 'fixture-0',
  featureSpecVersion: 1,
  inferenceMs: 0,
  tooCloseToCall: [[0, 1]],
  lines: [
    {
      index: 0,
      rank: 1,
      score: 0.58,
      confidence: 0.31,
      text: "You're doing your churn analysis backwards",
      normalisedText: "You're doing your churn analysis backwards",
      features: { char_count: 42, second_person_count: 2 },
      pairwise: { 1: 0.52, 2: 0.71 },
      notes: [
        {
          kind: 'helps',
          feature: 'second_person_count',
          contribution: 0.21,
          text: 'speaks to the reader directly',
          mine: 2,
          theirs: 0.5,
        },
        {
          kind: 'helps',
          feature: 'char_count',
          contribution: 0.08,
          text: '42 characters — shorter than the others you gave us',
          mine: 42,
          theirs: 43.5,
        },
        {
          kind: 'no-effect',
          feature: 'has_digit',
          contribution: 0.0004,
          text: 'no number',
          mine: 0,
          theirs: 0.5,
        },
      ],
      marks: [
        { start: 0, end: 6, kind: 'helps', label: '“You’re” — second person', feature: 'second_person_count' },
        { start: 13, end: 17, kind: 'helps', label: '“your” — second person', feature: 'second_person_count' },
      ],
    },
    {
      index: 1,
      rank: 2,
      score: 0.56,
      confidence: 0.28,
      text: 'The one chart that explains your churn',
      normalisedText: 'The one chart that explains your churn',
      features: { char_count: 38, second_person_count: 1 },
      pairwise: { 0: 0.48, 2: 0.69 },
      notes: [
        {
          kind: 'helps',
          feature: 'second_person_count',
          contribution: 0.11,
          text: 'speaks to the reader directly',
          mine: 1,
          theirs: 1,
        },
        {
          kind: 'hurts',
          feature: 'leading_demonstrative',
          contribution: -0.06,
          text: 'does not open on a demonstrative',
          mine: 0,
          theirs: 0,
        },
        {
          kind: 'no-effect',
          feature: 'comma_count',
          contribution: 0.0002,
          text: 'fewer commas',
          mine: 0,
          theirs: 0.5,
        },
      ],
      marks: [
        { start: 28, end: 32, kind: 'helps', label: '“your” — second person', feature: 'second_person_count' },
      ],
    },
    {
      index: 2,
      rank: 3,
      score: 0.36,
      confidence: 0.4,
      text: "We read 400 churn surveys 🔥 Here's what broke!",
      normalisedText: "We read 400 churn surveys 🔥 Here's what broke!",
      features: { char_count: 46, has_emoji: 1, ends_exclamation: 1 },
      pairwise: { 0: 0.29, 1: 0.31 },
      notes: [
        {
          kind: 'hurts',
          feature: 'ends_exclamation',
          contribution: -0.14,
          text: 'ends on an exclamation mark',
          mine: 1,
          theirs: 0,
        },
        {
          kind: 'hurts',
          feature: 'first_person_plur_count',
          contribution: -0.09,
          text: 'speaks as "we"',
          mine: 1,
          theirs: 0,
        },
        {
          kind: 'helps',
          feature: 'has_digit',
          contribution: 0.05,
          text: 'contains a number',
          mine: 1,
          theirs: 0,
        },
        {
          kind: 'not-measured',
          feature: 'has_emoji',
          contribution: 0,
          text:
            'Nothing to say about the emoji — it appears in almost none of the ' +
            'headlines this model learned from, so any opinion would be made up.',
        },
      ],
      marks: [
        { start: 46, end: 47, kind: 'hurts', label: 'terminal punctuation', feature: 'ends_exclamation' },
      ],
    },
  ],
};
