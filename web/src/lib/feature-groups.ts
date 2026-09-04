/**
 * Named groups of features that the product reasons about by name.
 *
 * There is exactly one of these today, and it was written down twice: once in
 * `lib/attribution.ts`, to decide whether the "nothing to say about the emoji"
 * note fires, and once in `components/Compare.tsx`, to decide whether the
 * standing "Not measured" panel calls emoji out by name. Two copies of the same
 * list is the same failure mode as two copies of a lexicon — they agree until
 * someone adds `emoji_skin_tone` to one of them, and then the per-line note and
 * the panel above it disagree about what the model has an opinion on.
 *
 * It lives in its own module rather than in `attribution.ts` because
 * `Compare.tsx` is a client component: importing from `attribution.ts` would
 * pull the phrase table and the generated lexicons into the browser bundle to
 * fetch four strings.
 */

/**
 * The emoji features, in the order `shared/feature_names.json` lists them.
 *
 * These are the features D-012 was written for and the ones a reader will look
 * for first: 2013–2015 Upworthy headlines barely contain emoji, so support falls
 * under the threshold and the trainer drops them. When that happens the product
 * says so out loud rather than letting silence read as approval.
 */
export const EMOJI_FEATURES = [
  'has_emoji',
  'emoji_count',
  'emoji_leading',
  'emoji_trailing',
] as const;

/** True when the champion consumes none of the emoji features (the D-012 case). */
export const usesEmojiFeatures = (modelFeatureNames: readonly string[]): boolean =>
  EMOJI_FEATURES.some((f) => modelFeatureNames.includes(f));

/** True when at least one emoji feature was explicitly dropped at training time. */
export const emojiWasDropped = (excludedFeatures: readonly string[]): boolean =>
  EMOJI_FEATURES.some((f) => excludedFeatures.includes(f));
