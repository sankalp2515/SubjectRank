/*
 * Ported from the handed-over design (exact-match-main/src/routes/evidence.tsx).
 * Layout, copy and classes are the design's; the route wrapper and the
 * metadata block are App Router equivalents of the TanStack originals.
 */
export const metadata = {
  title: "The evidence and its limits \u2014 SubjectRank",
  description: "27,616 randomised headline tests from the Upworthy Research Archive, what they support, and the four things they cannot tell you about your 2026 email.",
};

import Link from "next/link";
import { PageShell } from "@/components/subjectrank/site-chrome";
import { SectionLabel } from "@/components/subjectrank/primitives";
import { modelFacts } from "@/lib/model-facts";

/**
 * Measured on the temporal holdout — 8,999 pairs from 2,256 tests dated on or
 * after the cutoff, none of which the model saw. Not the cross-validation
 * numbers, which are higher and flatter the model, because editorial style
 * drifted across the archive and a random split would let it learn the drift.
 *
 * These come from the run report. If a figure is not in a run report it does not
 * appear on this page.
 */
const MEASURED = [
  { value: "0.2829", label: "top-1 accuracy: how often it puts the real winner first" },
  { value: "0.2259", label: "the same task, guessing at random" },
  { value: "0.5966", label: "pairwise accuracy on unseen pairs (0.5 is a coin flip)" },
  { value: "8,999", label: "held-out pairs it was scored on, from 2,256 tests" },
];

const LIMITS = [
  {
    title: "It is not email",
    body: "The archive is viral-media headlines shown on a website, not subject lines in an inbox. Absolute performance does not transfer. That the direction of these effects transfers is a hypothesis we hold, not a result we have.",
  },
  {
    title: "It is not 2026",
    body: "A decade separates the tests from your send. Reader habits, inbox design and filtering have all moved since.",
  },
  {
    title: "It is not your list",
    body: "Nothing here knows your audience, your sender reputation or your send time — the three things that usually matter most.",
  },
  {
    title: "It is English-language US media",
    body: "Non-Latin characters, other languages and other markets sit outside anything the data can speak to, so the interface marks them not measured rather than guessing.",
  },
];

export default async function EvidencePage() {
  const facts = await modelFacts();

  const CORPUS = [
    { value: "27,616", label: "randomised A/B headline tests used" },
    { value: "2013–2015", label: "when those tests were run" },
    facts.trainingCharMedian
      ? { value: `${facts.trainingCharMedian} chars`, label: "median length of a training headline" }
      : null,
    { value: "0", label: "open rates the model can predict" },
  ].filter(Boolean) as { value: string; label: string }[];

  return (
    <PageShell>
      <h1 className="text-4xl font-black leading-tight">The evidence, and what it cannot carry</h1>
      <p className="mt-3 text-sm font-semibold leading-relaxed text-muted-foreground">
        Every comparison on this site traces back to one public dataset. Here it is, along with the
        reasons to distrust it.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {CORPUS.map((f) => (
          <div key={f.label} className="glass-row p-4">
            <p className="text-2xl font-black text-brand">{f.value}</p>
            <p className="mt-1 text-xs font-bold text-muted-foreground">{f.label}</p>
          </div>
        ))}
      </div>

      {/*
        How well it actually does. The design had no section for this, because at
        the time there was no model to report on. Leaving it out now would mean a
        page called "the evidence" that never says whether the thing works — and
        the honest answer is "a little better than chance", which is worth
        printing precisely because it is modest.
      */}
      <section className="glass-panel mt-6 p-5">
        <SectionLabel>How well it actually does</SectionLabel>
        <p className="mt-2 text-sm font-semibold leading-relaxed text-muted-foreground">
          Measured on held-out tests the model never saw, dated after everything it learned
          from. These are the numbers to judge it by — not the training scores, which are
          higher and mean less.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {MEASURED.map((m) => (
            <div key={m.label} className="glass-row p-4">
              <p className="text-2xl font-black text-brand tabular-nums">{m.value}</p>
              <p className="mt-1 text-xs font-bold text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs font-semibold leading-relaxed text-muted-foreground">
          Read that honestly: it picks the winner about 28 times in 100 where guessing gets
          23. A real edge, and a small one. Most of what decides whether an email gets opened
          is not in the subject line at all.
        </p>
      </section>

      <div className="mt-6 flex flex-col gap-4">
        {LIMITS.map((l) => (
          <section key={l.title} className="glass-panel p-5">
            <h2 className="text-base font-black">{l.title}</h2>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-muted-foreground">
              {l.body}
            </p>
          </section>
        ))}
      </div>

      {/*
        This block said "No model deployed yet" and explained that rules stood in
        for one. A model serves now, so it reports which — and keeps the same
        place on the page, because "what is actually running" belongs next to the
        evidence either way.
      */}
      <section className="mt-6 rounded-3xl border border-helps/25 bg-helps-soft/70 p-5">
        <SectionLabel className="text-helps">What is serving right now</SectionLabel>
        <p className="mt-2 text-sm font-semibold leading-relaxed">
          {facts.ready ? (
            <>
              A pairwise ranker,{' '}
              <code className="rounded bg-foreground/8 px-1 py-0.5 font-mono text-xs">
                {facts.version}
              </code>
              , using {facts.featureCount} measured properties of the text and nothing else — it
              never sees your list, your send time or who you are.
              {facts.excludedFeatures.length > 0 ? (
                <>
                  {' '}
                  {facts.excludedFeatures.length} further properties were dropped because the
                  archive barely contains them, and the interface says &ldquo;not measured&rdquo;
                  about those rather than guessing.
                </>
              ) : null}
            </>
          ) : (
            <>
              No model is promoted in this build, so nothing is serving comparisons. That is a
              deployment state, not a result — the page will report the version as soon as one
              is promoted.
            </>
          )}
        </p>
      </section>

      <section className="mt-6 border-t border-border pt-5">
        <SectionLabel>Citation</SectionLabel>
        <p className="mt-2 text-xs font-semibold leading-relaxed text-muted-foreground">
          Matias, J.N., Munger, K., Le Quere, M.A. et al. The Upworthy Research Archive, a time
          series of 32,487 experiments in U.S. media. <em className="font-serif">Sci Data</em> 8,
          195 (2021). Licensed CC BY 4.0.
        </p>
      </section>

      <div className="mt-6">
        <Link
          href="/compare"
          className="gradient-brand inline-flex min-h-[48px] items-center rounded-2xl px-6 text-sm font-black text-primary-foreground"
        >
          Compare my lines anyway
        </Link>
      </div>
    </PageShell>
  );
}
