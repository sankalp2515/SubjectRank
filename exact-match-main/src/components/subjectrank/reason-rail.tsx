import type { Comparison, LineResult, ReasonState } from "@/lib/subjectrank/types";
import { directedProbability } from "@/lib/subjectrank/engine";
import { ReasonCard, ReasonKey } from "./reason";
import { SectionLabel } from "./primitives";

export function ReasonRail({
  comparison,
  line,
  onActivate,
  activeReasonId,
}: {
  comparison: Comparison;
  line: LineResult;
  activeReasonId: string | null;
  onActivate: (value: { lineId: string; reasonId: string; state: ReasonState } | null) => void;
}) {
  return (
    <div className="glass-panel p-5">
      <SectionLabel>Why {line.rankLabel}</SectionLabel>
      <p className="mt-2 font-serif text-base leading-snug">{line.text}</p>
      <p className="mt-2 text-xs font-semibold text-muted-foreground">
        Hover or focus a reason to light up the exact characters it points at.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {line.reasons.map((reason) => (
          <ReasonCard
            key={reason.id}
            reason={reason}
            active={activeReasonId === reason.id}
            onActivate={() => onActivate({ lineId: line.id, reasonId: reason.id, state: reason.state })}
            onClear={() => onActivate(null)}
          />
        ))}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <SectionLabel>Against each of your other lines</SectionLabel>
        <ul className="mt-2 space-y-2">
          {comparison.lines
            .filter((other) => other.id !== line.id)
            .map((other) => {
              const p = directedProbability(comparison.pairs, line.id, other.id) ?? 0.5;
              const tied =
                comparison.pairs.find(
                  (pair) =>
                    (pair.aId === line.id && pair.bId === other.id) ||
                    (pair.aId === other.id && pair.bId === line.id),
                )?.inseparable ?? false;
              return (
                <li key={other.id} className="text-xs font-semibold">
                  <span className="block truncate text-muted-foreground">{other.text}</span>
                  <span className="font-black">
                    {tied
                      ? "Cannot be separated"
                      : `Wins ${Math.round(p * 100)} times out of 100`}
                  </span>
                </li>
              );
            })}
        </ul>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <SectionLabel>What the four states mean</SectionLabel>
        <div className="mt-2">
          <ReasonKey />
        </div>
      </div>
    </div>
  );
}
