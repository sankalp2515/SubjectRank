/**
 * Turn what the model actually returned into what the interface renders.
 *
 * This file replaces `engine.ts` from the handed-over design. That file was a
 * hand-written rules engine — `MODEL_STATUS = "rules"`, a hardcoded
 * `MEDIAN_TRAINING_CHARS = 54`, and feature weights like `0.34` that were
 * chosen rather than fitted — carrying copy that made empirical claims ("won
 * their randomised pair more often") on behalf of a model it never consulted.
 *
 * The design was honest about being a placeholder. Shipping it against a real
 * trained model would not have been: the interface would have shown invented
 * weights and an invented training median while citing 27,616 randomised trials.
 *
 * So nothing here computes anything about language. Every number below is
 * carried from the deployed champion, and where the model has no answer this
 * file returns nothing rather than inventing one.
 */
import type { Comparison as ModelComparison, RankedLine } from '@/lib/model';
import { idFor, placingsFor } from '@/lib/placings';
import type { Comparison, LineResult, PairResult, Reason } from './types';

/** What `/api/rank` sends back. */
export interface RankResponse {
  comparison: ModelComparison;
  rankingId?: string;
  itemIds?: string[];
  excludedFeatures?: string[];
  trainingCharMedian?: number | null;
}

/**
 * Stable per-line id.
 *
 * Keyed on the line's position in what the user pasted, not on its rank, so a
 * selection survives a re-render and a highlight stays attached to the line the
 * reader clicked. `idFor` is the same A/B/C mark the verdict sentence uses, so
 * the id and the visible label cannot drift apart.
 */
const lineId = (inputIndex: number) => idFor(inputIndex);

function reasonsFor(line: RankedLine): Reason[] {
  return line.notes.map((note, i) => {
    // A mark is a span the attribution layer resolved to real characters. Only
    // some features have one — a length reason is about the whole line and has
    // nothing to point at — so an empty list here is a fact, not a gap (Q-012).
    const spans = line.marks
      .filter((m) => m.feature === note.feature)
      .map((m) => ({ start: m.start, end: m.end }));

    return {
      id: `${line.index}:${note.feature}:${i}`,
      state: note.kind,
      label: note.text,
      // The two numbers the sentence is actually about. Rendered as measured
      // values, never as a weight or a contribution — a coefficient is not
      // something a reader can check against their own line.
      detail:
        note.mine === undefined || note.theirs === undefined
          ? ''
          : `this line ${fmt(note.mine)} · your others ${fmt(note.theirs)}`,
      spans,
    };
  });
}

const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');

export function adapt(res: RankResponse): Comparison {
  const c = res.comparison;
  const placings = placingsFor(c.lines);

  const lines: LineResult[] = c.lines.map((l) => {
    const p = placings.get(l.index)!;
    return {
      id: lineId(l.index),
      text: l.text,
      rankStart: p.lo,
      rankEnd: p.hi,
      rankLabel: p.label,
      reasons: reasonsFor(l),
      // Counted on the normalised form, because that is the string the features
      // were computed on and the string the highlights index into.
      charCount: (l.normalisedText ?? l.text).length,
    };
  });

  // Every ordered pair the model actually scored. `pairwise[j]` is P(i beats j).
  const tooClose = new Set(
    c.tooCloseToCall.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`),
  );
  const pairs: PairResult[] = [];
  for (let a = 0; a < c.lines.length; a++) {
    for (let b = a + 1; b < c.lines.length; b++) {
      const ia = c.lines[a].index;
      const ib = c.lines[b].index;
      const p = c.lines[a].pairwise?.[ib];
      if (p === undefined) continue;
      pairs.push({
        aId: lineId(ia),
        bId: lineId(ib),
        probAWins: p,
        inseparable: tooClose.has(`${Math.min(ia, ib)}:${Math.max(ia, ib)}`),
      });
    }
  }

  return {
    lines,
    pairs,
    // From the model's own metadata. The design hardcoded 54; the deployed
    // champion reports its own value, and if it has none the gauge is not drawn
    // rather than drawn against a guess.
    medianTrainingCharCount: res.trainingCharMedian ?? null,
    modelVersion: c.modelVersion,
    excludedFeatures: res.excludedFeatures ?? [],
  };
}

/** Directed probability between two lines, or null when the model has none. */
export function directedProbability(
  comparison: Comparison,
  fromId: string,
  toId: string,
): number | null {
  for (const p of comparison.pairs) {
    if (p.aId === fromId && p.bId === toId) return p.probAWins;
    if (p.bId === fromId && p.aId === toId) return 1 - p.probAWins;
  }
  return null;
}

export function pairBetween(
  comparison: Comparison,
  x: string,
  y: string,
): PairResult | null {
  return (
    comparison.pairs.find(
      (p) => (p.aId === x && p.bId === y) || (p.aId === y && p.bId === x),
    ) ?? null
  );
}
