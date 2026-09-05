"use client";

import type { Comparison, LineResult, ReasonState } from "@/lib/subjectrank/types";
import { directedProbability, pairBetween } from "@/lib/subjectrank/adapt";
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
        Hover a reason to light up the characters it points at, where it has any. Reasons about the whole line show their numbers instead.
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
              const p = directedProbability(comparison, line.id, other.id);
              const tied = pairBetween(comparison, line.id, other.id)?.inseparable ?? false;
              return (
                <li key={other.id} className="text-xs font-semibold">
                  <span className="block truncate text-muted-foreground">{other.text}</span>
                  {/*
                    The design said "Wins 62 times out of 100". That is a claim
                    about what would happen across a hundred real sends, and it
                    is a claim about CALIBRATION -- that a stated 0.62 comes true
                    62% of the time. This model's accuracy was measured on a
                    temporal holdout; its calibration never was (Q-015). So the
                    number stays, because it is the model's real output between
                    these two named lines, and the frequency reading goes.
                  */}
                  <span className="font-black">
                    {tied || p === null
                      ? "Cannot be separated"
                      : `${p >= 0.5 ? "Model puts this line ahead" : "Model puts that line ahead"} · ${(p >= 0.5 ? p : 1 - p).toFixed(2)}`}
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
