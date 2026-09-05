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
