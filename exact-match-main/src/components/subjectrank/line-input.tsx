import { MAX_LINES, MIN_LINES } from "@/lib/subjectrank/engine";
import { ActionButton } from "./primitives";
import { cn } from "@/lib/utils";

const accents = [
  "bg-brand/15 text-brand",
  "bg-accent/20 text-accent-foreground",
  "bg-mint/25 text-helps",
  "bg-aqua/25 text-unknown",
  "bg-peach/30 text-hurts",
];

export function LineInput({
  lines,
  onChange,
  onCompare,
  onClear,
  busy,
  error,
}: {
  lines: string[];
  onChange: (next: string[]) => void;
  onCompare: () => void;
  onClear: () => void;
  busy: boolean;
  error: string | null;
}) {
  const filled = lines.filter((l) => l.trim()).length;
  const canAdd = lines.length < MAX_LINES;

  return (
    <div className="glass-panel p-5 sm:p-6">
      <h1 className="text-3xl font-black leading-tight sm:text-[2rem]">Compare your subject lines</h1>
      <p className="mt-2 text-sm font-semibold text-muted-foreground">
        Paste {MIN_LINES}–{MAX_LINES} lines. We hold them against each other, pair by pair, and show
        you which characters did the work.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {lines.map((line, index) => (
          <div key={index} className="glass-row flex items-center gap-3 px-3 py-2">
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-xl text-sm font-black",
                accents[index % accents.length],
              )}
            >
              {index + 1}
            </span>
            <label className="sr-only" htmlFor={`line-${index}`}>
              Subject line {index + 1}
            </label>
            <input
              id={`line-${index}`}
              value={line}
              onChange={(e) => {
                const next = [...lines];
                next[index] = e.target.value;
                onChange(next);
              }}
              placeholder={index === 0 ? "Your first subject line" : "Another line to weigh it against"}
              className="min-h-[40px] w-full bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground/70"
            />
            <span className="shrink-0 text-[11px] font-bold text-muted-foreground tabular-nums">
              {[...line].length}
            </span>
            {lines.length > MIN_LINES ? (
              <button
                type="button"
                onClick={() => onChange(lines.filter((_, i) => i !== index))}
                className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:text-destructive"
                aria-label={`Remove line ${index + 1}`}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionButton variant="quiet" onClick={() => onChange([...lines, ""])} disabled={!canAdd}>
          Add a line
        </ActionButton>
        <ActionButton variant="ghost" onClick={onClear}>
          Clear
        </ActionButton>
        <span className="ml-auto text-[11px] font-bold text-muted-foreground">
          {filled} of {MAX_LINES} filled
        </span>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive"
        >
          {error}
        </p>
      ) : null}

      <ActionButton className="mt-4 w-full py-3" onClick={onCompare} disabled={busy}>
        {busy ? "Comparing…" : `Compare ${Math.max(filled, MIN_LINES)} lines`}
      </ActionButton>
      <p className="mt-2 text-[11px] font-bold leading-relaxed text-muted-foreground">
        Pasted lines are stored and become training data for the next model. Delete them any time
        with one action below.
      </p>
    </div>
  );
}
