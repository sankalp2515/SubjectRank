import { ActionButton, SectionLabel } from "./primitives";

export function ModelStatusNotice() {
  return (
    <div className="rounded-3xl border-2 border-dashed border-unknown/45 bg-unknown-soft/70 p-4">
      <SectionLabel className="text-unknown">No model deployed yet</SectionLabel>
      <p className="mt-1.5 text-xs font-semibold leading-relaxed">
        The pairwise model is not serving here. Comparisons below come from the published
        feature-level findings of the archive, not from the model itself. Nothing on this page is a
        fabricated example — you are seeing real lines run through real rules, and we would rather
        say that than pretend.
      </p>
    </div>
  );
}

export function LimitationNotice() {
  return (
    <div className="rounded-3xl border border-brand/25 bg-brand/10 p-4">
      <SectionLabel className="text-brand">What this cannot tell you</SectionLabel>
      <p className="mt-1.5 text-xs font-semibold leading-relaxed">
        The evidence is 27,616 randomised A/B tests of viral-media headlines Upworthy ran between
        2013 and 2015. You are writing 2026 email. Absolute performance does not transfer, and the
        claim that the <em className="font-serif">direction</em> of these effects transfers is a
        hypothesis, not a finding. There is no predicted open rate here and there never will be: the
        model only compares two lines, so it cannot produce one.
      </p>
    </div>
  );
}

export function AccountOffer() {
  return (
    <div className="glass-panel flex flex-wrap items-center justify-between gap-3 p-5">
      <div>
        <p className="text-sm font-black">Keep this comparison</p>
        <p className="text-xs font-semibold text-muted-foreground">
          An account saves the lines and the outcomes you report. It is offered now because there is
          something to keep, not to get past a gate.
        </p>
      </div>
      <ActionButton className="shrink-0">Keep my work</ActionButton>
    </div>
  );
}

export function Citation({ onDeleteAll }: { onDeleteAll: () => void }) {
  return (
    <footer className="mt-10 border-t border-border pt-6 pb-10">
      <SectionLabel>Where the evidence comes from</SectionLabel>
      <p className="mt-2 max-w-3xl text-xs font-semibold leading-relaxed text-muted-foreground">
        Matias, J.N., Munger, K., Le Quere, M.A. et al. The Upworthy Research Archive, a time series
        of 32,487 experiments in U.S. media. <em className="font-serif">Sci Data</em> 8, 195 (2021).
        Licensed CC BY 4.0.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ActionButton variant="danger" onClick={onDeleteAll}>
          Delete everything I have submitted
        </ActionButton>
        <span className="text-[11px] font-bold text-muted-foreground">
          One action, no confirmation maze. Removes your lines and reported outcomes.
        </span>
      </div>
    </footer>
  );
}

export function ResultSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Comparing your lines">
      {[0, 1, 2].map((i) => (
        <div key={i} className="glass-row p-4">
          <div className="skeleton-shimmer h-4 w-2/3 rounded-full" />
          <div className="skeleton-shimmer mt-3 h-2 w-full rounded-full" />
          <div className="skeleton-shimmer mt-2 h-2 w-1/3 rounded-full" />
        </div>
      ))}
    </div>
  );
}
