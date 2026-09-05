import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell } from "@/components/subjectrank/site-chrome";
import { SectionLabel } from "@/components/subjectrank/primitives";
import { MEDIAN_TRAINING_CHARS } from "@/lib/subjectrank/engine";

export const Route = createFileRoute("/evidence")({
  head: () => ({
    meta: [
      { title: "The evidence and its limits — SubjectRank" },
      {
        name: "description",
        content:
          "27,616 randomised headline tests from the Upworthy Research Archive, what they support, and the four things they cannot tell you about your 2026 email.",
      },
      { property: "og:title", content: "The evidence and its limits — SubjectRank" },
      {
        property: "og:description",
        content:
          "Where the numbers come from, and an honest list of what this evidence cannot carry.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EvidencePage,
});

const FACTS = [
  { value: "27,616", label: "randomised A/B headline tests used" },
  { value: "2013–2015", label: "when those tests were run" },
  { value: `${MEDIAN_TRAINING_CHARS} chars`, label: "median length of a training headline" },
  { value: "0", label: "open rates the model can predict" },
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

function EvidencePage() {
  return (
    <PageShell>
      <h1 className="text-4xl font-black leading-tight">The evidence, and what it cannot carry</h1>
      <p className="mt-3 text-sm font-semibold leading-relaxed text-muted-foreground">
        Every comparison on this site traces back to one public dataset. Here it is, along with the
        reasons to distrust it.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {FACTS.map((f) => (
          <div key={f.label} className="glass-row p-4">
            <p className="text-2xl font-black text-brand">{f.value}</p>
            <p className="mt-1 text-xs font-bold text-muted-foreground">{f.label}</p>
          </div>
        ))}
      </div>

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

      <section className="mt-6 rounded-3xl border-2 border-dashed border-unknown/45 bg-unknown-soft/70 p-5">
        <SectionLabel className="text-unknown">No model deployed yet</SectionLabel>
        <p className="mt-2 text-sm font-semibold leading-relaxed">
          The pairwise model is not serving here. What you see comes from the published
          feature-level findings of the archive applied as explicit rules. We would rather tell you
          that than dress rules up as a model.
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
          to="/compare"
          className="gradient-brand inline-flex min-h-[48px] items-center rounded-2xl px-6 text-sm font-black text-primary-foreground"
        >
          Compare my lines anyway
        </Link>
      </div>
    </PageShell>
  );
}
