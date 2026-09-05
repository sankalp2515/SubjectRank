"use client";

import type { Comparison, LineResult, ReasonState } from "@/lib/subjectrank/types";
import { HighlightedLine } from "./highlighted-line";
import { cn } from "@/lib/utils";

interface Active {
  lineId: string;
  reasonId: string;
  state: ReasonState;
}

export function RankedList({
  comparison,
  active,
  selectedLineId,
  onSelectLine,
}: {
  comparison: Comparison;
  active: Active | null;
  selectedLineId: string;
  onSelectLine: (id: string) => void;
}) {
  const rows: (
    | { kind: "line"; line: LineResult }
    | { kind: "tie"; label: string; key: string }
  )[] = [];

  comparison.lines.forEach((line, index) => {
    const prev = comparison.lines[index - 1];
    if (prev && prev.rankStart === line.rankStart && prev.rankEnd === line.rankEnd) {
      rows.push({
        kind: "tie",
        key: `tie-${prev.id}-${line.id}`,
        label: `${line.rankLabel} · nothing separates these two`,
      });
    }
    rows.push({ kind: "line", line });
  });

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) =>
        row.kind === "tie" ? (
          <div
            key={row.key}
            className="rounded-2xl border-2 border-dashed border-unknown/45 bg-unknown-soft/70 px-3 py-2 text-center"
          >
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-unknown">
              {row.label}
            </span>
          </div>
        ) : (
          <RankRow
            key={row.line.id}
            line={row.line}
            median={comparison.medianTrainingCharCount}
            active={active?.lineId === row.line.id ? active : null}
            selected={selectedLineId === row.line.id}
            onSelect={() => onSelectLine(row.line.id)}
          />
        ),
      )}
    </div>
  );
}

function RankRow({
  line,
  median,
  active,
  selected,
  onSelect,
}: {
  line: LineResult;
  median: number | null;
  active: Active | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const tied = line.rankStart !== line.rankEnd;
  const reason = active ? line.reasons.find((r) => r.id === active.reasonId) : undefined;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "glass-row relative w-full overflow-hidden p-4 text-left transition-shadow",
        tied && "border-dashed border-unknown/40",
        selected && "shadow-[0_0_0_2px_var(--brand)]",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1.5",
          tied ? "bg-unknown/50" : "gradient-brand",
        )}
      />
      <span className="flex items-start gap-3 pl-2">
        <span
          className={cn(
            "grid min-h-9 min-w-9 shrink-0 place-items-center rounded-xl px-1.5 text-xs font-black",
            tied ? "bg-unknown/15 text-unknown" : "bg-brand/15 text-brand",
          )}
        >
          {line.rankLabel}
        </span>
        <span className="flex-1 text-sm font-bold leading-relaxed">
          <HighlightedLine
            text={line.text}
            spans={reason?.spans ?? []}
            state={reason?.state ?? null}
          />
        </span>
      </span>
      {/*
        The handed-over design put a bar here sized by the line's aggregate win
        probability, captioned "Beats your other lines 62% of the time". The bar
        is kept because the row needs it for rhythm; what it measures is not.

        A percentage with a filled bar reads as a grade no matter how it is
        captioned — a reader will quote "62%" as this line's score, and the model
        is pairwise and has no such number to give (D-002). The pairwise
        probabilities are not hidden: they are in the pair matrix below, between
        two named lines, which is the granularity the model actually works at.

        What the bar shows instead is length against the median of the headlines
        the model was fitted on. That is a measured fact about the training data,
        it comes from the model's own metadata rather than a constant, and the
        reader can check it by counting characters.
      */}
      {median ? (
        <LengthGauge chars={line.charCount} median={median} tied={tied} />
      ) : null}
      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 pl-11 text-[11px] font-bold text-muted-foreground">
        <span>{line.charCount} characters</span>
        {median ? <span>median in the training data was {median}</span> : null}
      </span>
    </button>
  );
}

/**
 * Length against the training median.
 *
 * The scale runs to whichever is larger — 1.8x the median, or a little past this
 * line — so a very long line still fits inside the track instead of pinning the
 * bar at full width and losing the comparison the gauge exists to make.
 */
function LengthGauge({
  chars,
  median,
  tied,
}: {
  chars: number;
  median: number;
  tied: boolean;
}) {
  const span = Math.max(median * 1.8, chars * 1.08);
  return (
    <span
      className="mt-3 block h-2 overflow-hidden rounded-full bg-foreground/10"
      role="img"
      aria-label={`${chars} characters, against a training median of ${median}`}
    >
      <span className="relative block h-full">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            tied ? "bg-unknown/60" : "gradient-brand",
          )}
          style={{ width: `${(chars / span) * 100}%` }}
        />
        {/* The median itself, so the bar is read as a comparison and not a fill level. */}
        <span
          className="absolute inset-y-0 w-0.5 bg-foreground/45"
          style={{ left: `${(median / span) * 100}%` }}
        />
      </span>
    </span>
  );
}
