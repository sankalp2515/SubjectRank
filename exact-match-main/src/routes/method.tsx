import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell } from "@/components/subjectrank/site-chrome";
import { SectionLabel } from "@/components/subjectrank/primitives";
import { ReasonKey } from "@/components/subjectrank/reason";
import { MAX_LINES, MEDIAN_TRAINING_CHARS, MIN_LINES } from "@/lib/subjectrank/engine";

export const Route = createFileRoute("/method")({
  head: () => ({
    meta: [
      { title: "How the comparison works — SubjectRank" },
      {
        name: "description",
        content:
          "Pair-by-pair comparison, order-independent ranking, character-level reasoning, and honest ties: exactly how SubjectRank arrives at an order.",
      },
      { property: "og:title", content: "How the comparison works — SubjectRank" },
      {
        property: "og:description",
        content:
          "Every placing traces back to a pair, and every reason traces back to characters in your line.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MethodPage,
});

const SECTIONS = [
  {
    title: "Pairs, not scores",
    body: `Each line meets every other line you pasted, one pair at a time. With ${MAX_LINES} lines that is ten separate head-to-head comparisons. The order you see is what those pairs add up to — there is no hidden total, and no line is ever measured against an imaginary average.`,
  },
  {
    title: "The order you type in changes nothing",
    body: "Lines are keyed by their text and sorted by their own properties, with alphabetical order as the only tie-break. Paste the same lines in a different order and you get the same ranking, every time.",
  },
  {
    title: "Reasons point at characters",
    body: "A reason is not a vibe. Each one carries the exact character positions it refers to, so hovering it lights up the number, the exclamation mark or the shouted word inside your line. If a reason cannot point at anything, it does not appear.",
  },
  {
    title: "Ties are allowed to stay ties",
    body: "When two lines sit inside the margin where the evidence cannot separate them, they share a placing and the interface says nothing separates these two. Forcing a winner there would be inventing one.",
  },
  {
    title: "Length is judged against the archive",
    body: `The training headlines had a median of ${MEDIAN_TRAINING_CHARS} characters. A line far above or below that band is flagged; inside it, length is reported as measured with no material difference — which is a finding, not a shrug.`,
  },
];

function MethodPage() {
  return (
    <PageShell>
      <h1 className="text-4xl font-black leading-tight">How the comparison works</h1>
      <p className="mt-3 text-sm font-semibold leading-relaxed text-muted-foreground">
        You paste {MIN_LINES}–{MAX_LINES} lines. Everything after that is arithmetic you are allowed
        to inspect.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {SECTIONS.map((s) => (
          <section key={s.title} className="glass-panel p-5">
            <h2 className="text-base font-black">{s.title}</h2>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-muted-foreground">
              {s.body}
            </p>
          </section>
        ))}
      </div>

      <section className="glass-panel mt-6 p-5">
        <SectionLabel>The four things a reason can be</SectionLabel>
        <div className="mt-3">
          <ReasonKey />
        </div>
      </section>

      <div className="mt-6">
        <Link
          to="/compare"
          className="gradient-brand inline-flex min-h-[48px] items-center rounded-2xl px-6 text-sm font-black text-primary-foreground"
        >
          Try it on your lines
        </Link>
      </div>
    </PageShell>
  );
}
