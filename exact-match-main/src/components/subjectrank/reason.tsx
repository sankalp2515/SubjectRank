import type { Reason, ReasonState } from "@/lib/subjectrank/types";
import { REASON_STATE_COPY } from "@/lib/subjectrank/types";
import { cn } from "@/lib/utils";

const stateStyles: Record<ReasonState, { chip: string; card: string; dot: string }> = {
  helps: {
    chip: "bg-helps-soft text-helps border border-helps/30",
    card: "bg-helps-soft/70 border border-helps/25",
    dot: "bg-helps",
  },
  hurts: {
    chip: "bg-hurts-soft text-hurts border border-hurts/30",
    card: "bg-hurts-soft/70 border border-hurts/25",
    dot: "bg-hurts",
  },
  "no-effect": {
    chip: "bg-neutral-state-soft text-neutral-state border border-neutral-state/30",
    card: "bg-neutral-state-soft/70 border border-neutral-state/25",
    dot: "bg-neutral-state",
  },
  "not-measured": {
    chip: "bg-unknown-soft text-unknown border-2 border-dashed border-unknown/50",
    card: "bg-unknown-soft/70 border-2 border-dashed border-unknown/45",
    dot: "bg-transparent border-2 border-dashed border-unknown",
  },
};

export function ReasonStateChip({ state, className }: { state: ReasonState; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide",
        stateStyles[state].chip,
        className,
      )}
    >
      {REASON_STATE_COPY[state]}
    </span>
  );
}

export function ReasonCard({
  reason,
  active,
  onActivate,
  onClear,
}: {
  reason: Reason;
  active: boolean;
  onActivate: () => void;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onActivate}
      onMouseLeave={onClear}
      onFocus={onActivate}
      onBlur={onClear}
      aria-pressed={active}
      className={cn(
        "w-full min-h-[44px] rounded-2xl p-3 text-left transition-shadow",
        stateStyles[reason.state].card,
        active && "shadow-[0_0_0_2px_var(--brand)]",
      )}
    >
      <span className="flex items-center gap-2">
        <ReasonStateChip state={reason.state} />
        <span className="text-xs font-black">{reason.label}</span>
      </span>
      <span className="mt-1.5 block text-xs font-semibold leading-relaxed text-muted-foreground">
        {reason.detail}
      </span>
      {reason.spans.length > 0 && reason.state !== "no-effect" ? (
        <span className="mt-1.5 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground/80">
          Points at characters {reason.spans.map((s) => `${s.start}–${s.end}`).join(", ")}
        </span>
      ) : null}
    </button>
  );
}

export function ReasonKey() {
  const items: { state: ReasonState; note: string }[] = [
    { state: "helps", note: "a measured property working in this line's favour" },
    { state: "hurts", note: "a measured property working against it" },
    { state: "no-effect", note: "measured, and it made no material difference" },
    { state: "not-measured", note: "no basis in the data — we have nothing to say" },
  ];
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.state} className="flex items-start gap-2 text-xs font-semibold">
          <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", stateStyles[item.state].dot)} />
          <span>
            <span className="font-black">{REASON_STATE_COPY[item.state]}</span>
            <span className="text-muted-foreground"> — {item.note}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
