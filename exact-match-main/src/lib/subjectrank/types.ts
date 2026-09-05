export type ReasonState = "helps" | "hurts" | "no-effect" | "not-measured";

export interface Span {
  start: number;
  end: number;
}

export interface Reason {
  id: string;
  state: ReasonState;
  label: string;
  detail: string;
  spans: Span[];
}

export interface LineResult {
  id: string;
  text: string;
  /** 1-based placing; equal to rankEnd unless the line is in a tie group. */
  rankStart: number;
  rankEnd: number;
  rankLabel: string;
  /** Probability this line beats a randomly chosen one of the other lines pasted. */
  winProbability: number;
  reasons: Reason[];
  charCount: number;
}

export interface PairResult {
  aId: string;
  bId: string;
  /** Probability a beats b. */
  probAWins: number;
  inseparable: boolean;
}

export interface Comparison {
  lines: LineResult[];
  pairs: PairResult[];
  medianTrainingCharCount: number;
}

export const REASON_STATE_COPY: Record<ReasonState, string> = {
  helps: "helps",
  hurts: "hurts",
  "no-effect": "no effect",
  "not-measured": "not measured",
};
