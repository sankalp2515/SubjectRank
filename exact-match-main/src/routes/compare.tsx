import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/subjectrank/site-chrome";
import { CompareApp } from "@/components/subjectrank/compare-app";

export const Route = createFileRoute("/compare")({
  head: () => ({
    meta: [
      { title: "Compare subject lines — SubjectRank" },
      {
        name: "description",
        content:
          "Paste 2–5 email subject lines and see the pairwise ranking, the reasoning behind every placing, and the pairs the model cannot separate.",
      },
      { property: "og:title", content: "Compare subject lines — SubjectRank" },
      {
        property: "og:description",
        content:
          "Head-to-head subject-line comparison with inspectable reasoning and honest ties.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ComparePage,
});

function ComparePage() {
  return (
    <PageShell wide>
      <CompareApp />
    </PageShell>
  );
}
