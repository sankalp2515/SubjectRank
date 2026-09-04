import { Compare } from '@/components/subjectrank/Compare';
import { DeleteMine } from '@/components/subjectrank/AfterResult';
import { Alert } from '@/components/ui';
import { PRODUCT } from '@/lib/product';
import { readWorkedExample } from '@/lib/worked';
import worked from '@/lib/generated/worked_example.json';

export const dynamic = 'force-static';

export default function Page() {
  /* Ranking comes from the promoted ONNX graph at build time; the reasoning is
     derived here by the same TypeScript the live request path runs, so there is
     exactly one implementation of attribution. See lib/worked.ts. */
  const w = readWorkedExample(worked);

  return (
    <>
      {/* Soft colour fields behind everything. Decoration that stays away from
          any control — a gradient on a button is the template this product
          argues against. */}
      <div className="glows" aria-hidden="true">
        <span className="glow-a" />
        <span className="glow-b" />
      </div>

      <nav className="nav">
        <div className="nav-inner">
          <a className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">SR</span>
            <span>
              <span className="brand-name">
                {PRODUCT.name}
                <span className="pill pill-hide-sm">27,616 trials</span>
              </span>
              <span className="brand-tag">Compare, don&rsquo;t score</span>
            </span>
          </a>
        </div>
      </nav>

      <main className="shell">
        <section className="hero">
          <span className="hero-badge">
            <span className="pill-dot" style={{ background: 'var(--helps-fg)' }} aria-hidden="true" />
            27,616 randomised trials, published openly
          </span>
          <h1>
            Subject line tools give you a score.{' '}
            <em>We rank your real alternatives.</em>
          </h1>
          <p>
            Readers do not judge your subject line in isolation — they choose
            between what you sent and whatever sits next to it. This compares the
            lines you actually wrote, using a model trained on real randomised
            A/B tests, and tells you when it cannot tell two of them apart.
          </p>
        </section>

        {/*
          The limitation sits above the input, not in a footnote and not behind a
          link. It costs conversion. It is also the only thing here that a tool
          printing a confident meaningless score cannot say, so it stays.
        */}
        <section className="limit" aria-labelledby="limit-head">
          <span className="eyebrow" id="limit-head">What this cannot do</span>
          <p>
            It learned from randomised tests of{' '}
            <strong>viral media headlines from 2013&ndash;2015</strong>. You are
            writing email in 2026. Absolute performance does not survive that gap,
            which is why nothing here predicts an open rate.
          </p>
          <p>
            That the <strong>direction</strong> of these effects carries over to
            email is a hypothesis, not a finding. Nothing public exists to test it
            on. Telling us what happened when you sent one is how that changes.
          </p>
        </section>

        <Compare
          example={w.ready ? w.comparison : null}
          exampleMedianChars={w.ready ? w.trainingCharMedian : null}
          excludedFeatures={w.ready ? w.excludedFeatures : []}
          noModelNotice={
            /* No champion at build time. A fabricated example here would be the
               exact thing this product exists to argue against. */
            <Alert tone="info" title="No worked example" className="panel-gap">
              No model was deployed when this page was built, so there is no
              example comparison to show you. Paste two lines and they will run
              against whatever model is live. There is no placeholder ranking
              here, because a made-up ranking is the thing this tool exists to
              argue against.
            </Alert>
          }
        />

        <section className="panel panel-gap">
          <h3 className="panel-title">Why there is no score out of 100</h3>
          <p className="panel-sub">
            The model is pairwise: it only ever answers &ldquo;which of these two
            wins&rdquo;, and it is structurally incapable of producing an absolute
            number. Tools that hand you a score are predicting open rate — a
            metric Apple Mail Privacy Protection made substantially less
            trustworthy, because it pre-fetches tracking pixels, so an unknowable
            share of reported opens are machines rather than readers. That is why
            this asks for your clicks as well as your opens.
          </p>
        </section>

        <footer className="foot">
          <p>
            Training data: {PRODUCT.dataCitation.text} Used under{' '}
            {PRODUCT.dataCitation.licence}.{' '}
            <a href={PRODUCT.dataCitation.href} rel="noreferrer noopener">
              doi.org/10.1038/s41597-021-00934-7
            </a>
          </p>
          <p>
            The lines you paste are stored and become training data for the next
            version of this model. That is how it gets better at email instead of
            headlines, and saying so plainly is the price of doing it.
          </p>
          <DeleteMine />
        </footer>
      </main>
    </>
  );
}
