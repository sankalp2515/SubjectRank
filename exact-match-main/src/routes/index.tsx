import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell } from "@/components/subjectrank/site-chrome";
import { SectionLabel } from "@/components/subjectrank/primitives";
import { ReasonKey } from "@/components/subjectrank/reason";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SubjectRank — compare email subject lines, honestly" },
      {
        name: "description",
        content:
          "Paste 2–5 email subject lines and see them ranked against each other, pair by pair, with reasoning you can check. No score out of 100, no predicted open rate.",
      },
      { property: "og:title", content: "SubjectRank — compare email subject lines, honestly" },
      {
        property: "og:description",
        content:
          "Pairwise subject-line comparison built on 27,616 randomised Upworthy headline tests. It compares, it never scores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const STEPS = [
  {
    title: "Paste two to five lines",
    body: "No account, no gate. The comparison needs at least one rival line, so two is the floor.",
  },
  {
    title: "Every pair is weighed",
    body: "Each line meets every other line head to head. Five lines make ten separate comparisons.",
  },
  {
    title: "The reasons stay open",
    body: "Tap any reason and the exact characters it refers to light up inside the line itself.",
  },
];

const PROMISES = [
  {
    title: "No score out of 100",
    body: "A single number would imply a precision the evidence cannot support. You get an order and the pairs behind it.",
  },
  {
    title: "No predicted open rate",
    body: "The model compares two lines. It has no way to produce a rate, so it never shows one.",
  },
  {
    title: "Ties stay ties",
    body: "When two lines cannot be separated, they share a placing and say so, instead of being forced apart.",
  },
  {
    title: "\u201cNot measured\u201d is a real answer",
    body: "Emoji, merge tags and non-Latin characters sit outside the archive. We say nothing rather than guess.",
  },
];

function Landing() {
  return (
    <PageShell>
      <section className="glass-panel p-6 sm:p-9">
        <SectionLabel>Free · no sign-up · 2–5 lines</SectionLabel>
        <h1 className="mt-3 text-4xl font-black leading-[1.05] sm:text-5xl">
          It compares your subject lines. It refuses to score them.
        </h1>
        <p className="mt-4 text-base font-semibold leading-relaxed text-muted-foreground">
          Paste the lines you are choosing between and see them held against each other, pair by
          pair, with every reason traceable to the characters that caused it. Built on 27,616
          randomised headline tests — and honest about everything those tests cannot tell you.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to="/compare"
            className="gradient-brand inline-flex min-h-[48px] items-center rounded-2xl px-6 text-sm font-black text-primary-foreground shadow-[0_14px_30px_-14px_var(--brand)] hover:brightness-105"
          >
            Compare my lines
          </Link>
          <Link
            to="/method"
            className="inline-flex min-h-[48px] items-center rounded-2xl border border-glass-border bg-glass-strong px-5 text-sm font-black hover:bg-card"
          >
            See how it works
          </Link>
        </div>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <div key={step.title} className="glass-panel p-5">
            <span className="grid size-9 place-items-center rounded-xl bg-brand/15 text-sm font-black text-brand">
              {i + 1}
            </span>
            <h2 className="mt-3 text-sm font-black">{step.title}</h2>
            <p className="mt-1.5 text-xs font-semibold leading-relaxed text-muted-foreground">
              {step.body}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-6 glass-panel p-6">
        <SectionLabel>What we will never show you</SectionLabel>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {PROMISES.map((p) => (
            <div key={p.title}>
              <h2 className="text-sm font-black">{p.title}</h2>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-muted-foreground">
                {p.body}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-5 border-t border-border pt-4">
          <ReasonKey />
        </div>
      </section>

      <section className="mt-6 glass-panel flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h2 className="text-lg font-black">Ready when you are</h2>
          <p className="text-xs font-semibold text-muted-foreground">
            Nothing to install, nothing to sign. Delete everything you paste with one action.
          </p>
        </div>
        <Link
          to="/compare"
          className="gradient-brand inline-flex min-h-[48px] items-center rounded-2xl px-6 text-sm font-black text-primary-foreground"
        >
          Start comparing
        </Link>
      </section>
    </PageShell>
  );
}
