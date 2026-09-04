'use client';

import { useState } from 'react';

import { PlacingList } from '@/components/subjectrank/PlacingList';
import { Scale } from '@/components/subjectrank/Scale';
import type { Comparison } from '@/lib/model';
import { placingsFor, verdict } from '@/lib/placings';

/**
 * The result half of Compare, rendered from fixture data.
 *
 * It uses the SAME components the real page does, so what is inspected here is
 * the real surface. Only the numbers feeding it are invented, and the route
 * above says so in the loudest state the design has.
 */
export function Harness({
  comparison, medianChars, excluded,
}: { comparison: Comparison; medianChars: number; excluded: string[] }) {
  const [disputed, setDisputed] = useState<Set<number>>(new Set());
  const placings = placingsFor(comparison.lines);

  return (
    <section className="result">
      <div className="result-head">
        <span className="m">Comparison</span>
        <span className="m">model {comparison.modelVersion} · spec v{comparison.featureSpecVersion}</span>
      </div>

      <p className="verdict">{verdict(comparison.lines, placings)}</p>

      <Scale lines={comparison.lines} placings={placings} />

      <PlacingList
        lines={comparison.lines}
        placings={placings}
        trainingMedianChars={medianChars}
        disputed={disputed}
        onDisagree={(i) => setDisputed((p) => new Set(p).add(i))}
      />

      {excluded.length > 0 && (
        <div className="nothing">
          <span className="m">Not measured</span>
          <p>
            {excluded.length} properties were left out of this model entirely: the
            2013&ndash;2015 headlines it learned from barely contain them, and a
            coefficient fitted on a handful of examples is noise with a confident
            sign on it. <strong>Emoji are the main one.</strong> This model has no
            opinion about your emoji, and you should not read its silence as
            approval.
          </p>
        </div>
      )}
    </section>
  );
}
