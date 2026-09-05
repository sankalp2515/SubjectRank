/*
 * Ported from the handed-over design (exact-match-main/src/routes/method.tsx).
 * Layout and voice are the design's. Two sections describe how the ranking is
 * produced, and both described the rules engine that used to sit behind it, so
 * their bodies are rewritten against what the deployed model actually does. The
 * notes on each say what changed and why.
 */
export const metadata = {
  title: 'How the comparison works — SubjectRank',
  description:
    'Pair-by-pair comparison, order-independent ranking, character-level reasoning, and honest ties: exactly how SubjectRank arrives at an order.',
};

import Link from 'next/link';
import { PageShell } from '@/components/subjectrank/site-chrome';
import { SectionLabel } from '@/components/subjectrank/primitives';
import { ReasonKey } from '@/components/subjectrank/reason';
import { PRODUCT } from '@/lib/product';
import { modelFacts } from '@/lib/model-facts';

const { minLines, maxLines } = PRODUCT.limits;
const maxPairs = (maxLines * (maxLines - 1)) / 2;

export default async function MethodPage() {
  const facts = await modelFacts();

  const SECTIONS = [
    {
      title: 'Pairs, not scores',
      body: `Each line meets every other line you pasted, one pair at a time. With ${maxLines} lines that is ${maxPairs} separate head-to-head comparisons. The order you see is what those pairs add up to — there is no hidden total, and no line is ever measured against an imaginary average.`,
    },
    {
      /*
        The design said lines were "keyed by their text and sorted by their own
        properties, with alphabetical order as the only tie-break". That
        described the rules engine. The model ranks by aggregating pairwise
        probabilities, and its order-independence comes from antisymmetry being
        enforced during training and gated before deploy — a stronger and more
        specific claim than alphabetical sorting, and the true one.
      */
      title: 'The order you type in changes nothing',
      body:
        'The model is trained so that comparing A against B always gives exactly the ' +
        'complement of comparing B against A. That property is checked before every ' +
        'deploy by running the same lines through the live service in all 24 orderings ' +
        'and requiring the ranking not to move. Paste the same lines in a different ' +
        'order and you get the same result, to the last decimal.',
    },
    {
      /*
        The design said "If a reason cannot point at anything, it does not
        appear." That is false here, and it is the claim Q-012 was opened
        against: most reasons are about length or word count, which are
        properties of the whole line and have no characters to point at. Hiding
        them would mean hiding the model's main reasons; claiming they all point
        somewhere would be a lie. So the page says which kind is which.
      */
      title: 'Some reasons point at characters, and some cannot',
      body:
        'A reason that is about something in particular — a number, an exclamation mark, ' +
        'a shouted word — carries the exact character positions it refers to, and hovering ' +
        'it lights them up inside your line. A reason about the whole line, like its length ' +
        'or how many words it has, has nothing to point at, and says so instead of ' +
        'highlighting something arbitrary. Both kinds show the two numbers they compare, ' +
        'so either way you can check the claim.',
    },
    {
      title: 'Ties are allowed to stay ties',
      body:
        'When two lines sit inside the margin where the evidence cannot separate them, ' +
        'they share a placing and the interface says nothing separates these two. ' +
        'Forcing a winner there would be inventing one.',
    },
    facts.trainingCharMedian
      ? {
          title: 'Length is judged against the archive',
          body: `The headlines this model was fitted on had a median of ${facts.trainingCharMedian} characters, and every line shows its own length against that mark. Being far from it is not a verdict — it is the one number on the page you can check by counting.`,
        }
      : null,
  ].filter(Boolean) as { title: string; body: string }[];

  return (
    <PageShell>
      <h1 className="text-4xl font-black leading-tight">How the comparison works</h1>
      <p className="mt-3 text-sm font-semibold leading-relaxed text-muted-foreground">
        You paste {minLines}–{maxLines} lines. Everything after that is arithmetic you are
        allowed to inspect.
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
          href="/compare"
          className="gradient-brand inline-flex min-h-[48px] items-center rounded-2xl px-6 text-sm font-black text-primary-foreground"
        >
          Try it on your lines
        </Link>
      </div>
    </PageShell>
  );
}
