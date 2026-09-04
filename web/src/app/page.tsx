import { Compare } from '@/components/subjectrank/Compare';
import { DeleteMine } from '@/components/subjectrank/AfterResult';
import { PRODUCT } from '@/lib/product';
import { readWorkedExample } from '@/lib/worked';
import worked from '@/lib/generated/worked_example.json';

export const dynamic = 'force-static';

export default function Page() {
  /* The ranking comes from the promoted ONNX graph at build time; the reasoning
     is derived here by the same TypeScript the live request path runs, so there
     is exactly one implementation of attribution. See lib/worked.ts. */
  const w = readWorkedExample(worked);

  return (
    <main className="shell">
      <header className="masthead">
        <span className="wordmark">{PRODUCT.name}</span>
        <span className="m">Ranks. Never scores.</span>
      </header>

      {/*
        Claim and caveat share the width, at equal weight, side by side on a wide
        screen. Giving the limitation the same real estate as the pitch is the
        positioning stated as layout, and it fixes a page that was otherwise a
        narrow ragged column with half the viewport empty beside it.
      */}
      <div className="head">
      {/*
        Set at subject-line size on purpose. The largest text on this page belongs
        to the visitor; a tool that refuses to inflate its claims should not
        inflate its own headline either.
      */}
      <p className="claim">
        Paste the subject lines you are choosing between. This puts them{' '}
        <b>in order against each other</b> and shows its working.{' '}
        <span className="off">There is no score. It cannot compute one.</span>
      </p>

      {/*
        The limitation sits above the input, not in a footnote and not behind a
        link. It costs conversion. It is also the only thing here that a tool
        printing a confident meaningless score cannot say, so it stays.
      */}
      <section className="limit" aria-labelledby="limit-head">
        <span className="m" id="limit-head">What this cannot do</span>
        <p>
          It learned from randomised tests of{' '}
          <strong>viral media headlines from 2013&ndash;2015</strong>. You are
          writing email in 2026. Absolute performance does not survive that gap,
          which is why nothing here predicts an open rate.
        </p>
        <p>
          That the <strong>direction</strong> of these effects carries over to email
          is a hypothesis, not a finding. Nothing public exists to test it on.
          Telling us what happened when you sent one is how that changes.
        </p>
      </section>
      </div>

      <Compare
        example={w.ready ? w.comparison : null}
        exampleMedianChars={w.ready ? w.trainingCharMedian : null}
        excludedFeatures={w.ready ? w.excludedFeatures : []}
        noModelNotice={
          /* No champion at build time. A fabricated example here would be the
             exact thing this product exists to argue against, so the page says
             what is missing instead. It disappears the moment a model is live. */
          <div className="notice" role="status">
            <span className="m">No worked example</span>
            <p>
              No model was deployed when this page was built, so there is no
              example comparison to show you. Paste two lines and they will run
              against whatever model is live. There is no placeholder ranking here,
              because a made-up ranking is the thing this tool exists to argue
              against.
            </p>
          </div>
        }
      />

      <footer className="foot">
        <div>
          <span className="m">Where the evidence comes from</span>
          <p className="cite">
            {PRODUCT.dataCitation.text} Used under {PRODUCT.dataCitation.licence}.{' '}
            <a href={PRODUCT.dataCitation.href} rel="noreferrer noopener">
              doi.org/10.1038/s41597-021-00934-7
            </a>
          </p>
        </div>
        <div>
          <span className="m">What happens to your lines</span>
          <p>
            They are stored, and they become training data for the next version of
            this model. That is how it gets better at email instead of headlines,
            and saying so plainly is the price of doing it.
          </p>
          {/* The other half of that sentence, immediately under it. One action,
              one place — it used to be stated twice on this page in two slightly
              different wordings, which is one wording too many for a promise
              about someone's data. */}
          <DeleteMine />
        </div>
      </footer>
    </main>
  );
}
