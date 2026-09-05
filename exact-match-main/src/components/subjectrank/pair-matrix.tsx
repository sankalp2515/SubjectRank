import type { Comparison } from "@/lib/subjectrank/types";
import { directedProbability, pairBetween } from "@/lib/subjectrank/engine";
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
      <div className="mt-3 overflow-x-auto">
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
                  const p = directedProbability(comparison.pairs, row.id, col.id) ?? 0.5;
                  const tied = pairBetween(comparison.pairs, row.id, col.id)?.inseparable;
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
