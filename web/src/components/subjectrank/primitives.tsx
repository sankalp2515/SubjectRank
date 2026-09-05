"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function GlassPanel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn("glass-panel p-5 sm:p-6", className)} {...props}>
      {children}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-[11px] font-black uppercase tracking-[0.15em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * A labelled panel for the states the product has to be able to say out loud:
 * no model deployed, a limitation, something the model has no opinion about.
 *
 * The four tones map to the reason states in the design system rather than to a
 * generic info/warn/error set, so a notice about something unmeasured looks like
 * every other unmeasured thing on the page.
 */
export function Notice({
  tone = "brand",
  label,
  children,
  className,
}: {
  tone?: "brand" | "helps" | "hurts" | "unknown";
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const panel = {
    brand: "border border-brand/25 bg-brand/10",
    helps: "border border-helps/25 bg-helps-soft/70",
    hurts: "border border-hurts/25 bg-hurts-soft/70",
    unknown: "border-2 border-dashed border-unknown/45 bg-unknown-soft/70",
  } as const;
  const labelTone = {
    brand: "text-brand",
    helps: "text-helps",
    hurts: "text-hurts",
    unknown: "text-unknown",
  } as const;

  return (
    <div className={cn("rounded-3xl p-4", panel[tone], className)}>
      <SectionLabel className={labelTone[tone]}>{label}</SectionLabel>
      <p className="mt-1.5 text-xs font-semibold leading-relaxed text-foreground">{children}</p>
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "ghost" | "danger";
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "gradient-brand text-primary-foreground shadow-[0_12px_28px_-14px_var(--brand)] hover:brightness-105",
  quiet: "bg-glass-strong border border-glass-border text-foreground hover:bg-card",
  ghost: "text-muted-foreground hover:text-foreground",
  danger: "text-destructive hover:bg-destructive/10 border border-destructive/25",
};

export function ActionButton({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black transition-[filter,background-color,color] disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
