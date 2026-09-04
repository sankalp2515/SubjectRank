/**
 * Turning scores into placings a person can trust.
 *
 * The rule this file exists to enforce: **a placing is only a single number when
 * the model has earned it.** Everywhere else it is a range.
 *
 * Every other tool in this category prints an ordered list. An ordered list can
 * only say "this one is second", which is a claim the model very often cannot
 * support - two lines separated by less than the noise floor are being put in an
 * order by the sort, not by the evidence. Here that line reads `1st-2nd` instead,
 * and the reader can see exactly how much is known.
 */
import type { RankedLine } from './model';

/**
 * Below this gap in aggregate score, we say so rather than inventing an order.
 *
 * It lives HERE rather than in model.ts, and model.ts imports it from here,
 * because this module runs in the browser: reaching into model.ts for a runtime
 * value pulled the whole ONNX runtime into the client bundle. Type-only imports
 * from model.ts are erased and stay safe.
 */
export const TOO_CLOSE_THRESHOLD = 0.04;

export type Placing = {
  /** Best placing this line could hold, 1-based. */
  lo: number;
  /** Worst placing it could hold. Equal to `lo` when the model separated it. */
  hi: number;
  /** True when lo === hi: an exact placing the evidence supports. */
  exact: boolean;
  /** "2nd", or "1st-3rd". */
  label: string;
};

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];
export const ordinal = (n: number) => ORDINALS[n - 1] ?? `${n}th`;

/** The letter that ties an input field to its row in the comparison. */
export const idFor = (inputIndex: number) => String.fromCharCode(65 + inputIndex);

/**
 * Two lines are inseparable when their aggregate scores differ by less than the
 * threshold the server already applies. Same rule, same constant - this widens it
 * from adjacent pairs to all pairs, which is what a range needs.
 */
const separable = (a: number, b: number) => Math.abs(a - b) >= TOO_CLOSE_THRESHOLD;

/**
 * Placings for every line, keyed by the line's position in the user's input.
 *
 * `lo` counts the lines that beat this one *decisively*; `hi` counts the ones it
 * beats decisively. Deliberately NOT a transitive grouping: with scores
 * .60 / .57 / .54 and a .04 threshold, the first and last ARE separable even
 * though neither is separable from the middle. Chaining them into one "tie group"
 * would report the top line as possibly-third, which the evidence contradicts.
 */
export function placingsFor(lines: RankedLine[]): Map<number, Placing> {
  const n = lines.length;
  const out = new Map<number, Placing>();

  for (const line of lines) {
    let beatenBy = 0;
    let beats = 0;
    for (const other of lines) {
      if (other.index === line.index) continue;
      if (!separable(line.score, other.score)) continue;
      if (other.score > line.score) beatenBy++;
      else beats++;
    }
    const lo = beatenBy + 1;
    const hi = n - beats;
    out.set(line.index, {
      lo, hi,
      exact: lo === hi,
      label: lo === hi ? ordinal(lo) : `${ordinal(lo)}\u2013${ordinal(hi)}`,
    });
  }
  return out;
}

/** Lines the model will not rule out of first place. */
export function contenders(lines: RankedLine[], placings: Map<number, Placing>): RankedLine[] {
  return lines.filter((l) => (placings.get(l.index)?.lo ?? 99) === 1);
}

/**
 * One sentence saying what the comparison found, in the words a person would use.
 *
 * Written here rather than in the component so the wording cannot drift from the
 * placings it describes - the failure being avoided is a heading that announces a
 * winner above a column showing a tie.
 */
export function verdict(lines: RankedLine[], placings: Map<number, Placing>): string {
  const top = contenders(lines, placings);
  const names = top.map((l) => idFor(l.index));

  /* Lines that share a placing range share a label, so grouping by label finds
     exactly the sets the model could not separate. */
  const groups = new Map<string, string[]>();
  for (const l of lines) {
    const label = placings.get(l.index)!.label;
    groups.set(label, [...(groups.get(label) ?? []), idFor(l.index)]);
  }
  const tied = [...groups.values()].filter((g) => g.length > 1);

  if (names.length === lines.length && lines.length > 1) {
    return 'The model cannot separate any of these. Any of them could come first.';
  }

  if (names.length > 1) {
    return `${list(names)} could each come first — the model cannot tell them apart.`;
  }

  if (!tied.length) {
    return `${names[0]} comes first, and the model can tell all ${lines.length} of these apart.`;
  }

  /* One winner, but something below it is inseparable. Name the lines rather
     than counting them: "some of the 2 others are too close to separate" made
     the reader work out which two, and the whole point of this sentence is that
     it says exactly what the model does and does not know. */
  const said = tied.map((g) => list(g)).join(', and ');
  return `${names[0]} comes first. Below that, nothing separates ${said}.`;
}

/** "A", "A and B", "A, B and C". */
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
