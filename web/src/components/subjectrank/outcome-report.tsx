"use client";

import { useState } from "react";
import type { LineResult } from "@/lib/subjectrank/types";
import { ActionButton, SectionLabel } from "./primitives";
import { cn } from "@/lib/utils";

const appleShares = ["Don't know", "Under a quarter", "About half", "Most of it"];

export function OutcomeReport({ lines }: { lines: LineResult[] }) {
  const [sentId, setSentId] = useState(lines[0]?.id ?? "");
  const [opens, setOpens] = useState("");
  const [clicks, setClicks] = useState("");
  const [listSize, setListSize] = useState("");
  const [appleShare, setAppleShare] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="glass-panel p-5">
        <SectionLabel>Logged</SectionLabel>
        <p className="mt-2 text-sm font-bold">
          Your send is in. Reported outcomes are what the next model gets trained on.
        </p>
        <ActionButton variant="quiet" className="mt-3" onClick={() => setDone(false)}>
          Report another send
        </ActionButton>
      </div>
    );
  }

  return (
    <form
      className="glass-panel p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(true);
      }}
    >
      <SectionLabel>Tell us what actually happened</SectionLabel>
      <p className="mt-2 text-xs font-semibold text-muted-foreground">
        Fifteen seconds, no login. We ask for clicks as well as opens because Apple Mail pre-fetches
        tracking pixels, so a share of reported opens are machines. Clicks are what the training data
        measured.
      </p>

      {/*
        min-w-0 on a fieldset is not cosmetic. Browsers give <fieldset> an
        intrinsic minimum width of its min-content and it ignores the usual
        shrinking rules, so a long subject line inside one widened the whole page
        by 16px at 375px. It is the last element you would suspect, because
        nothing in the markup says it behaves differently from a div — which is
        why measuring scrollWidth beats reading the CSS.
      */}
      <fieldset className="mt-4 min-w-0">
        <legend className="text-xs font-black">Which line did you send?</legend>
        <div className="mt-2 flex flex-col gap-1.5">
          {lines.map((line) => (
            <label
              key={line.id}
              className={cn(
                "glass-row flex min-h-[44px] cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold",
                sentId === line.id && "shadow-[0_0_0_2px_var(--brand)]",
              )}
            >
              <input
                type="radio"
                name="sent-line"
                className="accent-brand"
                checked={sentId === line.id}
                onChange={() => setSentId(line.id)}
              />
              {/*
                min-w-0 is what makes `truncate` work at all. A flex item's
                automatic minimum is its min-content width, so without it this
                span refuses to shrink, never ellipsises, and pushes the label
                past the viewport instead — 16px of horizontal page scroll on a
                375px screen, caused by the one class meant to prevent it.
              */}
              <span className="min-w-0 truncate">{line.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Opens" value={opens} onChange={setOpens} placeholder="1204" />
        <Field label="Clicks" value={clicks} onChange={setClicks} placeholder="87" />
      </div>
      <div className="mt-3">
        <Field label="List size (optional)" value={listSize} onChange={setListSize} placeholder="9500" />
      </div>

      {/*
        min-w-0 on a fieldset is not cosmetic. Browsers give <fieldset> an
        intrinsic minimum width of its min-content and it ignores the usual
        shrinking rules, so a long subject line inside one widened the whole page
        by 16px at 375px. It is the last element you would suspect, because
        nothing in the markup says it behaves differently from a div — which is
        why measuring scrollWidth beats reading the CSS.
      */}
      <fieldset className="mt-4 min-w-0">
        <legend className="text-xs font-black">
          Roughly what share of your list is Apple Mail? (optional)
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {appleShares.map((share) => (
            <button
              key={share}
              type="button"
              onClick={() => setAppleShare(appleShare === share ? null : share)}
              className={cn(
                "min-h-[44px] rounded-2xl border border-glass-border bg-glass-strong px-3 text-xs font-black transition-colors",
                appleShare === share && "gradient-brand text-primary-foreground",
              )}
            >
              {share}
            </button>
          ))}
        </div>
      </fieldset>

      <ActionButton type="submit" className="mt-4 w-full">
        Send the numbers
      </ActionButton>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block text-xs font-black">
      {label}
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block min-h-[44px] w-full rounded-2xl border border-glass-border bg-glass-strong px-3 text-sm font-bold outline-none placeholder:font-semibold placeholder:text-muted-foreground/70"
      />
    </label>
  );
}
