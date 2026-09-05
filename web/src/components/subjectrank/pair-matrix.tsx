"use client";

import type { Comparison } from "@/lib/subjectrank/types";
import { directedProbability, pairBetween } from "@/lib/subjectrank/adapt";
import { SectionLabel } from "./primitives";
import { cn } from "@/lib/utils";

export function PairMatrix({ comparison }: { comparison: Comparison }) {
  const lines = comparison.lines;
  return (
    <div className="glass-panel p-5">
      <SectionLabel>Every pair, on its own</SectionLabel>
      <p className="mt-2 text-xs font-semibold text-muted-foreground">
        The model only ever answers one question: which of these two wins. Everything above is built
        from these answers.
      </p>
      {/*
        min-w-0 is load-bearing. A grid item's automatic minimum size is its
        min-content width, so without it this container could not shrink
        below the table and the whole panel grew to 395px inside a 375px
        viewport -- the table never scrolled, the page did.
      */}
      <div className="mt-3 min-w-0 overflow-x-auto">
        <table className="w-full min-w-[280px] text-xs font-bold">
          <caption className="sr-only">Win probability of the row line against the column line</caption>
          <thead>
            <tr>
              <th scope="col" className="p-1 text-left font-black text-muted-foreground">
                row wins
              </th>
              {lines.map((line, i) => (
                <th key={line.id} scope="col" className="p-1 text-center text-muted-foreground">
                  {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((row, i) => (
              <tr key={row.id}>
                <th scope="row" className="p-1 text-left text-muted-foreground">
                  {i + 1}
                </th>
                {lines.map((col) => {
                  if (col.id === row.id)
                    return (
                      <td key={col.id} className="p-1 text-center text-muted-foreground">
                        —
                      </td>
                    );
                  const p = directedProbability(comparison, row.id, col.id);
                  const tied = pairBetween(comparison, row.id, col.id)?.inseparable;

                  // No probability for this pair means the model was never asked
                  // about it. The design defaulted that to 0.5, which paints an
                  // even-odds cell the model never produced — a missing answer
                  // rendered as a confident one. It shows as absent instead.
                  if (p === null) {
                    return (
                      <td key={col.id} className="p-1 text-center">
                        <span
                          className="inline-block min-w-11 rounded-lg px-1.5 py-1 text-muted-foreground"
                          title="This pair was not scored"
                        >
                          —
                        </span>
                      </td>
                    );
                  }

                  return (
                    <td key={col.id} className="p-1 text-center">
                      <span
                        className={cn(
                          "inline-block min-w-11 rounded-lg px-1.5 py-1 tabular-nums",
                          tied
                            ? "border-2 border-dashed border-unknown/50 bg-unknown-soft text-unknown"
                            : p > 0.5
                              ? "bg-helps-soft text-helps"
                              : "bg-hurts-soft text-hurts",
                        )}
                      >
                        {tied ? "tie" : p.toFixed(2)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="mt-3 space-y-1 text-[11px] font-semibold text-muted-foreground">
        {lines.map((line, i) => (
          <li key={line.id} className="truncate">
            {i + 1}. {line.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
