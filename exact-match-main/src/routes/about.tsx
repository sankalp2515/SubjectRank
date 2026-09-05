import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell } from "@/components/subjectrank/site-chrome";
import { SectionLabel } from "@/components/subjectrank/primitives";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About SubjectRank — and your data" },
      {
        name: "description",
        content:
          "Why SubjectRank compares instead of scoring, what happens to the lines you paste, and how to delete everything in one action.",
      },
      { property: "og:title", content: "About SubjectRank — and your data" },
      {
        property: "og:description",
        content:
          "A tool that refuses to invent precision, and a plain account of what it keeps and for how long.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AboutPage,
});

const FAQ = [
  {
    q: "Why is there no score out of 100?",
    a: "Because the evidence cannot support one. A score implies the tool knows how good a line is on its own. It does not — it only knows how two of your lines compare.",
  },
  {
    q: "Why will you not predict my open rate?",
    a: "A pairwise comparison has no units of open rate in it. Producing one would mean inventing a number, and the invented number would be the thing people quoted.",
  },
  {
    q: "Two of my lines tied. Is that a bug?",
    a: "No. It means the difference between them falls inside the margin where the evidence cannot tell them apart. Pick on taste, or send both.",
  },
  {
    q: "I disagree with the order.",
    a: "There is a one-tap disagree control next to every result. Disagreements are counted and read; they are the main signal for the next model.",
  },
];

function AboutPage() {
  return (
    <PageShell>
      <h1 className="text-4xl font-black leading-tight">About SubjectRank</h1>
      <p className="mt-3 text-sm font-semibold leading-relaxed text-muted-foreground">
        Most subject-line tools answer a question the data cannot answer, then round it to a number.
        This one answers a smaller question properly: of the lines in front of you, which beats
        which, and on what grounds.
      </p>

      <section className="glass-panel mt-6 p-5">
        <SectionLabel>What we keep</SectionLabel>
        <ul className="mt-3 space-y-2 text-sm font-semibold leading-relaxed text-muted-foreground">
          <li>
            <span className="font-black text-foreground">The lines you paste.</span> They become
            training data for the next model. That is stated before you paste, not after.
          </li>
          <li>
            <span className="font-black text-foreground">Outcomes you choose to report.</span> Which
            line you sent, and the opens and clicks it got — optional, and useful.
          </li>
          <li>
            <span className="font-black text-foreground">Your disagreements.</span> Counted, read,
            and acted on.
          </li>
          <li>
            <span className="font-black text-foreground">Nothing else.</span> No account is required
            to use any of it.
          </li>
        </ul>
        <p className="mt-3 text-xs font-bold text-muted-foreground">
          One action on the compare page deletes all of it, with no confirmation maze.
        </p>
      </section>

      <section className="mt-6 flex flex-col gap-4">
        {FAQ.map((item) => (
          <div key={item.q} className="glass-panel p-5">
            <h2 className="text-base font-black">{item.q}</h2>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-muted-foreground">
              {item.a}
            </p>
          </div>
        ))}
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/compare"
          className="gradient-brand inline-flex min-h-[48px] items-center rounded-2xl px-6 text-sm font-black text-primary-foreground"
        >
          Compare my lines
        </Link>
        <Link
          to="/evidence"
          className="inline-flex min-h-[48px] items-center rounded-2xl border border-glass-border bg-glass-strong px-5 text-sm font-black hover:bg-card"
        >
          Read the limits
        </Link>
      </div>
    </PageShell>
  );
}
