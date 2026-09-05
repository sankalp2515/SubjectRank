"use client";

import { useState } from "react";
import { adapt, type RankResponse } from "@/lib/subjectrank/adapt";
import { PRODUCT } from "@/lib/product";
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

const { minLines, maxChars } = PRODUCT.limits;

type Active = { lineId: string; reasonId: string; state: ReasonState } | null;

/**
 * The worked example is computed by the real model on the server and handed in
 * as a prop. The design generated it in the browser from the rules engine; doing
 * that now would mean the first thing a visitor sees is the one comparison on
 * the page that the deployed model never produced.
 */
export function CompareApp({ example }: { example: Comparison }) {
  const [lines, setLines] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Active>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [disagreed, setDisagreed] = useState(false);
  const [ownResult, setOwnResult] = useState<Comparison | null>(null);
  const [deleted, setDeleted] = useState(false);

  const comparison = ownResult ?? example;
  const isOwn = ownResult !== null;

  const selected =
    comparison.lines.find((l) => l.id === selectedLineId) ?? comparison.lines[0]!;

  async function runComparison() {
    const filled = lines.map((l) => l.trim()).filter(Boolean);
    if (filled.length < minLines) {
      setError("Two lines is the minimum — a comparison needs something to compare against.");
      return;
    }
    if (new Set(filled).size !== filled.length) {
      setError("Two of your lines are identical. Change one so there is a real pair to weigh.");
      return;
    }
    const tooLong = filled.find((l) => l.length > maxChars);
    if (tooLong) {
      setError(`One line is ${tooLong.length} characters. The limit is ${maxChars}.`);
      return;
    }
    setError(null);
    setBusy(true);
    setDeleted(false);
    setDisagreed(false);

    // Real inference, over the network. The design used a 550ms setTimeout to
    // simulate this; the skeleton it was there to show now covers a request that
    // genuinely takes time, and a failure is reported rather than swallowed.
    try {
      const res = await fetch("/api/rank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines: filled }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "The comparison failed on our side. Nothing you did — try again.");
        return;
      }
      const result = adapt(body as RankResponse);
      setOwnResult(result);
      setSelectedLineId(result.lines[0]!.id);
    } catch {
      setError("Could not reach the model. Check your connection and compare again.");
    } finally {
      setBusy(false);
    }
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
        <div className="min-w-0 lg:col-span-5">
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
            {/*
              The design gated this on MODEL_STATUS === "rules" and showed a
              "no trained model is deployed" warning. A trained model IS deployed
              now, so the notice reports which one rather than apologising for
              its absence.
            */}
            <ModelStatusNotice version={comparison.modelVersion} />
          </div>
        </div>

        <div className="min-w-0 lg:col-span-4">
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

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
          <ReasonRail
            comparison={comparison}
            line={selected}
            activeReasonId={active?.lineId === selected.id ? active.reasonId : null}
            onActivate={setActive}
          />
        </div>
      </div>

      <section className="mt-4 grid gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5">
          <PairMatrix comparison={comparison} />
        </div>
        <div className="min-w-0 lg:col-span-4">
          <OutcomeReport lines={comparison.lines} />
        </div>
        <div className="min-w-0 lg:col-span-3">
          <div className="flex flex-col gap-4">
            <AccountOffer />
            <div className="glass-panel p-5">
              {/*
                This described bars that showed each line's aggregate win
                probability. Those bars are gone — they read as a score — so the
                copy now describes what is actually on screen: a length gauge,
                and a matrix of directed probabilities between named lines.
              */}
              <SectionLabel>Reading the numbers</SectionLabel>
              <p className="mt-2 text-xs font-semibold leading-relaxed text-muted-foreground">
                The bar under each line is its length against the median of the headlines the
                model learned from — not a grade. The only probabilities here are in the pair
                matrix, and each one is the chance of one of your lines beating one other of
                your lines. None of it is an open rate or a share of your audience. Reorder
                your inputs and the ranking will not move.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Citation onDeleteAll={deleteEverything} />
    </>
  );
}
