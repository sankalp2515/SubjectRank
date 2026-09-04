'use client';

import type { RankedLine } from '@/lib/model';
import type { Placing } from '@/lib/placings';
import { LineBlock } from './LineBlock';

/**
 * The ranked column, with the ties drawn BETWEEN the rows rather than inside
 * them.
 *
 * That placement is the point. A card can only ever say "this one is second";
 * the thing the model actually knows is sometimes about the *gap* between two
 * lines, and a gap has to be drawn in the gap. So where two placings overlap, a
 * strip sits physically between the two blocks and says so, and neither line is
 * given the visual treatment of a winner.
 *
 * Shared by the live comparison and the design harness so the two cannot drift.
 */
export function PlacingList({
  lines, placings, trainingMedianChars, onDisagree, onInspect, disputed,
}: {
  lines: RankedLine[];
  placings: Map<number, Placing>;
  trainingMedianChars: number | null;
  onDisagree?: (inputIndex: number) => void;
  /** Fired the first time someone traces a reason back to the words it marks. */
  onInspect?: () => void;
  disputed: Set<number>;
}) {
  return (
    <div className="placing-list">
      {lines.map((line, i) => {
        const here = placings.get(line.index)!;
        const next = lines[i + 1] ? placings.get(lines[i + 1].index) : null;
        const tied = next ? here.hi >= next.lo && next.hi >= here.lo : false;

        return (
          <div key={line.index}>
            <LineBlock
              line={line}
              placing={here}
              trainingMedianChars={trainingMedianChars}
              onDisagree={onDisagree ? () => onDisagree(line.index) : undefined}
              onInspect={onInspect}
              disagreed={disputed.has(line.index)}
            />
            {tied && (
              <div className="tie-bar">
                <span className="rule" aria-hidden="true" />
                <span className="m">Nothing separates these two</span>
                <span className="rule" aria-hidden="true" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
