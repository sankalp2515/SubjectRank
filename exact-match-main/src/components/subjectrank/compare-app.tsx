import { useMemo, useState } from "react";
import { compareLines, MIN_LINES, MODEL_STATUS } from "@/lib/subjectrank/engine";
import type { Comparison, ReasonState } from "@/lib/subjectrank/types";
import { LineInput } from "./line-input";
import { RankedList } from "./ranked-list";
import { ReasonRail } from "./reason-rail";
import { PairMatrix } from "./pair-matrix";
import { OutcomeReport } from "./outcome-report";
import {
  AccountOffer,
  Citation,
  LimitationNotice,
  ModelStatusNotice,
  ResultSkeleton,
} from "./notices";
import { ActionButton, SectionLabel } from "./primitives";

const WORKED_EXAMPLE = [
  "Summer sale is live — 40% off ends tonight",
  "Your 40% is waiting, and it goes at midnight",
  "Quick question before your cart expires",
];

type Active = { lineId: string; reasonId: string; state: ReasonState } | null;

export function CompareApp() {
  const [lines, setLines] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Active>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [disagreed, setDisagreed] = useState(false);
  const [ownResult, setOwnResult] = useState<Comparison | null>(null);
  const [deleted, setDeleted] = useState(false);

  const example = useMemo(() => compareLines(WORKED_EXAMPLE), []);
  const comparison = ownResult ?? example;
  const isOwn = ownResult !== null;

  const selected =
    comparison.lines.find((l) => l.id === selectedLineId) ?? comparison.lines[0]!;

  function runComparison() {
    const filled = lines.map((l) => l.trim()).filter(Boolean);
    if (filled.length < MIN_LINES) {
      setError("Two lines is the minimum — a comparison needs something to compare against.");
      return;
    }
    if (new Set(filled).size !== filled.length) {
      setError("Two of your lines are identical. Change one so there is a real pair to weigh.");
      return;
    }
    setError(null);
    setBusy(true);
    setDeleted(false);
    setDisagreed(false);
    window.setTimeout(() => {
      const result = compareLines(filled);
      setOwnResult(result);
      setSelectedLineId(result.lines[0]!.id);
      setBusy(false);
    }, 550);
  }

  function deleteEverything() {
    setLines(["", ""]);
    setOwnResult(null);
    setSelectedLineId(null);
    setActive(null);
    setDisagreed(false);
    setError(null);
    setDeleted(true);
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <LineInput
            lines={lines}
            onChange={setLines}
            onCompare={runComparison}
            onClear={() => setLines(["", ""])}
            busy={busy}
            error={error}
          />
          <div className="mt-4 flex flex-col gap-4">
            <LimitationNotice />
            {MODEL_STATUS === "rules" ? <ModelStatusNotice /> : null}
          </div>
        </div>

        <div className="lg:col-span-4">
          <div className="glass-panel p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-black">Comparison</h2>
              <span className="text-[11px] font-bold text-muted-foreground">
                {isOwn ? "your lines" : "worked example, three real lines"} ·{" "}
                {(comparison.lines.length * (comparison.lines.length - 1)) / 2} pairs
              </span>
            </div>

            {busy ? (
              <ResultSkeleton />
            ) : (
              <RankedList
                comparison={comparison}
                active={active}
                selectedLineId={selected.id}
                onSelectLine={(id) => setSelectedLineId(id)}
              />
            )}

            {deleted ? (
              <p className="mt-3 rounded-2xl bg-glass-strong px-3 py-2 text-xs font-bold">
                Everything you submitted is gone. Paste new lines whenever you like.
              </p>
            ) : null}

            <div className="mt-4 border-t border-border pt-4">
              <ActionButton
                variant={disagreed ? "primary" : "quiet"}
                className="w-full"
                onClick={() => setDisagreed((d) => !d)}
                aria-pressed={disagreed}
              >
                {disagreed ? "Noted — you disagree with this order" : "I disagree with this order"}
              </ActionButton>
              <p className="mt-2 text-[11px] font-bold text-muted-foreground">
                One tap, always here. Disagreements are counted and read.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-3">
          <ReasonRail
            comparison={comparison}
            line={selected}
            activeReasonId={active?.lineId === selected.id ? active.reasonId : null}
            onActivate={setActive}
          />
        </div>
      </div>

      <section className="mt-4 grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <PairMatrix comparison={comparison} />
        </div>
        <div className="lg:col-span-4">
          <OutcomeReport lines={comparison.lines} />
        </div>
        <div className="lg:col-span-3">
          <div className="flex flex-col gap-4">
            <AccountOffer />
            <div className="glass-panel p-5">
              <SectionLabel>Reading the bars</SectionLabel>
              <p className="mt-2 text-xs font-semibold leading-relaxed text-muted-foreground">
                Every number here is a probability of one of your lines beating another of your
                lines. It is not an open rate, a grade, or a share of your audience. Reorder your
                inputs and the ranking will not move.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Citation onDeleteAll={deleteEverything} />
    </>
  );
}
