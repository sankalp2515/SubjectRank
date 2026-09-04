import { notFound } from 'next/navigation';

import { PRODUCT } from '@/lib/product';
import { EXCLUDED, FIXTURE, TRAINING_MEDIAN_CHARS } from './fixture';
import { Harness } from './Harness';

export const dynamic = 'force-dynamic';

/**
 * Design harness. Renders the comparison surface from invented numbers so it can
 * be looked at while no model is deployed.
 *
 * 404 in production - the same posture /admin takes. The gate is on NODE_ENV
 * rather than on a token because there is nothing here worth authenticating; it
 * simply must not exist on the deployed site.
 */
export default function DevPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="shell">
      <header className="masthead">
        <span className="wordmark">{PRODUCT.name}</span>
        <span className="m">Design harness</span>
      </header>

      <div className="notice bad" role="status" style={{ marginTop: 22 }}>
        <span className="m">Invented numbers — not a real comparison</span>
        <p>
          Every score, reason and measurement below is made up, so that the
          comparison surface can be looked at before a model exists. This route is
          404 in production and nothing on the real page imports it.
        </p>
      </div>

      <Harness
        comparison={FIXTURE}
        medianChars={TRAINING_MEDIAN_CHARS}
        excluded={EXCLUDED}
      />
    </main>
  );
}
