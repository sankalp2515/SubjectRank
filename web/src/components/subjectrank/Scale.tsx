'use client';

import type { RankedLine } from '@/lib/model';
import { contenders, idFor, type Placing } from '@/lib/placings';

/**
 * Every line plotted on one shared scale.
 *
 * Rank is spatial here, not numeric, and that is the point: two knobs nearly
 * touching is the model admitting it can barely separate those lines. A scorer
 * cannot show you this, because it has already collapsed the margin into a
 * number before you see it.
 */

/**
 * The window is FIXED by default so two different comparisons look comparable.
 * A window fitted to the data would rescale every time and make a decisive
 * result and a coin flip draw identically.
 */
const DEFAULT_LO = 0.35;
const DEFAULT_HI = 0.65;

function windowFor(scores: number[]) {
  // It widens rather than clamps. Clamping would draw two different scores at
  // the same position, which is a small lie in exactly the place this component
  // exists to be honest about.
  const lo = Math.max(0, Math.min(DEFAULT_LO, ...scores.map((s) => s - 0.02)));
  const hi = Math.min(1, Math.max(DEFAULT_HI, ...scores.map((s) => s + 0.02)));
  return { lo, hi, at: (s: number) => ((s - lo) / (hi - lo)) * 100 };
}

export function Scale({
  lines, placings,
}: { lines: RankedLine[]; placings: Map<number, Placing> }) {
  const { lo, hi, at } = windowFor(lines.map((l) => l.score));

  /*
   * The filled knob means "this one won". It is therefore drawn only when
   * exactly ONE line is still in the running for first.
   *
   * Keying it on `rank === 1` was wrong and it was the bad kind of wrong: the
   * sort puts something at rank 1 whether or not the model can defend it, so a
   * comparison whose column correctly read `1st–2nd` on two lines still crowned
   * one of them on the scale directly above it. The picture contradicted the
   * words in exactly the place this product claims to be careful.
   */
  const stillInTheRunning = contenders(lines, placings);
  const soleWinner = stillInTheRunning.length === 1 ? stillInTheRunning[0].index : null;

  // Hidden rather than pinned to an edge if the even point falls outside the
  // window: a tick labelled 0.50 that is not at 0.50 is worse than no tick.
  const evenVisible = 0.5 >= lo && 0.5 <= hi;

  // Brackets under runs the model could not separate, drawn between the two
  // pins they actually join.
  const brackets: Array<{ left: number; width: number }> = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    const pa = placings.get(a.index);
    const pb = placings.get(b.index);
    // Overlapping placing ranges is the same fact the column reports. Deriving
    // the bracket from the placings rather than recomputing it means the scale
    // and the column can never disagree.
    if (!pa || !pb) continue;
    if (pa.hi >= pb.lo && pb.hi >= pa.lo) {
      const x1 = at(b.score);
      const x2 = at(a.score);
      brackets.push({ left: Math.min(x1, x2), width: Math.max(Math.abs(x2 - x1), 2) });
    }
  }

  return (
    <div className="scale-wrap">
      <span className="m">How often each line won, against the others you gave us</span>

      <div className="scale">
        <span className="scale-bar" aria-hidden="true" />

        {brackets.map((b, k) => (
          <span
            key={`b${k}`}
            className="span-tie"
            style={{ left: `${b.left}%`, width: `${b.width}%` }}
            aria-hidden="true"
          />
        ))}

        {evenVisible && (
          <span className="scale-even" style={{ left: `${at(0.5)}%` }} aria-hidden="true" />
        )}

        {lines.map((l) => (
          <span
            key={l.index}
            className={`pin${l.index === soleWinner ? ' lead' : ''}`}
            style={{ left: `${at(l.score)}%` }}
          >
            <span className="knob" aria-hidden="true">{idFor(l.index)}</span>
            <span className="stem" aria-hidden="true" />
          </span>
        ))}
      </div>

      {/*
        Direction only, never a number. The window is 0.35–0.65 by default, so a
        cap reading "lost every time" at the left edge would be false, and a cap
        reading "0.35" would be a figure the reader has no way to interpret and
        is simply being asked to trust. "Even" is the one point on this axis that
        means something on its own.
      */}
      <div className="scale" style={{ height: 18, marginTop: 0 }} aria-hidden="true">
        <span className="m scale-cap" style={{ left: 0 }}>&larr; lost more</span>
        {evenVisible && (
          <span className="m scale-cap mid" style={{ left: `${at(0.5)}%` }}>Even</span>
        )}
        <span className="m scale-cap right">won more &rarr;</span>
      </div>
    </div>
  );
}
