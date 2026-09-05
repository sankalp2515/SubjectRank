"use client";

import type { ReasonState, Span } from "@/lib/subjectrank/types";
import { cn } from "@/lib/utils";

const markStyles: Record<ReasonState, string> = {
  helps: "bg-helps-soft text-helps rounded-[4px] shadow-[inset_0_-2px_0_var(--helps)]",
  hurts: "bg-hurts-soft text-hurts rounded-[4px] shadow-[inset_0_-2px_0_var(--hurts)]",
  "no-effect":
    "bg-neutral-state-soft text-neutral-state rounded-[4px] shadow-[inset_0_-2px_0_var(--neutral-state)]",
  "not-measured":
    "bg-unknown-soft text-unknown rounded-[4px] shadow-[inset_0_-2px_0_var(--unknown)] outline-1 outline-dashed outline-unknown/60",
};

export function HighlightedLine({
  text,
  spans,
  state,
  className,
}: {
  text: string;
  spans: Span[];
  state: ReasonState | null;
  className?: string;
}) {
  if (!state || spans.length === 0) {
    return <span className={cn("break-words", className)}>{text}</span>;
  }

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: { text: string; marked: boolean }[] = [];
  let cursor = 0;
  for (const span of sorted) {
    const start = Math.max(cursor, Math.min(span.start, text.length));
    const end = Math.max(start, Math.min(span.end, text.length));
    if (start > cursor) parts.push({ text: text.slice(cursor, start), marked: false });
    if (end > start) parts.push({ text: text.slice(start, end), marked: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), marked: false });

  return (
    <span className={cn("break-words", className)}>
      {parts.map((part, i) =>
        part.marked ? (
          <mark key={i} className={cn("bg-transparent px-0.5", markStyles[state])}>
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}
