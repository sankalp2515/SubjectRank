/**
 * The shape the interface renders.
 *
 * Ported from the handed-over design, which described these types well: a
 * placing that spans `rankStart`..`rankEnd` is exactly the range mechanic this
 * product needs (D-017), and an explicit `pairs` list is the model's real output
 * at its real granularity.
 *
 * One field was removed rather than carried over. The design had a
 * `winProbability` on every line, rendered as a progress bar and as "beats your
 * other lines 62% of the time". That reads as a score out of 100 no matter how
 * it is captioned, and D-002 forbids it: the model is pairwise and cannot
 * produce an absolute number. The pairwise probabilities survive, in `pairs`,
 * where they are labelled as what they are.
 */
export type ReasonState = 'helps' | 'hurts' | 'no-effect' | 'not-measured';

export interface Span {
  start: number;
  end: number;
}

export interface Reason {
  id: string;
  state: ReasonState;
  label: string;
  detail: string;
  /** Character offsets into the NORMALISED line, so highlights land correctly. */
  spans: Span[];
}

export interface LineResult {
  id: string;
  text: string;
  /** 1-based placing. Equal to `rankEnd` unless the line sits in a tie group. */
  rankStart: number;
  rankEnd: number;
  /** "1st", or a range like "1st-2nd" when the model has not earned a number. */
  rankLabel: string;
  reasons: Reason[];
  charCount: number;
}

export interface PairResult {
  aId: string;
  bId: string;
  /**
   * P(a beats b), straight from the model.
   *
   * This is kept and shown, unlike the per-line aggregate. It is not a score:
   * it is a directed probability between two specific lines the user wrote,
   * displayed in a matrix that says so. That is the model answering the only
   * question it can answer, at the granularity it answers it.
   */
  probAWins: number;
  inseparable: boolean;
}

export interface Comparison {
  lines: LineResult[];
  pairs: PairResult[];
  /** From the deployed model's own metadata. Never a constant in the source. */
  medianTrainingCharCount: number | null;
  modelVersion: string;
  /** Features the model excluded for lack of training support (D-012). */
  excludedFeatures: string[];
}

export const REASON_STATE_COPY: Record<ReasonState, string> = {
  helps: 'helps',
  hurts: 'hurts',
  'no-effect': 'no effect',
  'not-measured': 'not measured',
};
