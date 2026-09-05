"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/compare", label: "Compare" },
  { to: "/method", label: "How it works" },
  { to: "/evidence", label: "The evidence" },
  { to: "/about", label: "About" },
] as const;

export function SiteHeader() {
  // TanStack's <Link activeProps> has no App Router equivalent, so the active
  // state is derived from the path. Exact match for "/" only — otherwise every
  // route would light up Home, since every path starts with a slash.
  const pathname = usePathname();
  const isActive = (to: string) =>
    to === "/" ? pathname === "/" : pathname.startsWith(to);

  return (
    <header className="sticky top-0 z-30 border-b border-glass-border bg-glass-strong/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
        <Link href="/" className="flex items-center gap-3">
          <span className="gradient-mark grid size-10 place-items-center rounded-2xl text-lg font-black text-primary-foreground shadow-[0_12px_28px_-14px_var(--bloom)]">
            S
          </span>
          <span>
            <span className="block text-base font-black leading-none">SubjectRank</span>
            <span className="block text-[11px] font-bold text-muted-foreground">
              it compares, it does not score
            </span>
          </span>
        </Link>

        <nav aria-label="Main" className="flex flex-wrap items-center gap-1 sm:ml-auto">
          {NAV.map((item) => (
            <Link
              key={item.to}
              href={item.to}
              aria-current={isActive(item.to) ? "page" : undefined}
              className={
                isActive(item.to)
                  ? "rounded-xl bg-brand/12 px-3 py-2 text-xs font-black text-brand"
                  : "rounded-xl px-3 py-2 text-xs font-black text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 sm:px-5">
        <p className="text-[11px] font-bold text-muted-foreground">
          SubjectRank · pairwise comparison only · no predicted open rates
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-3">
          {NAV.map((item) => (
            <Link
              key={item.to}
              href={item.to}
              className="text-[11px] font-black text-muted-foreground hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export function PageShell({
  children,
  wide,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen w-full text-foreground">
      <SiteHeader />
      <main
        className={
          wide
            ? "mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8"
            : "mx-auto max-w-3xl px-4 py-8 sm:px-5 sm:py-12"
        }
      >
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
