'use client';

import { useState } from 'react';

import type { Mark, Note } from '@/lib/attribution';
import type { RankedLine } from '@/lib/model';
import { idFor, type Placing } from '@/lib/placings';
import { Badge, type BadgeTone } from '@/components/ui';

/**
 * One line, its placing, and the reasoning you can check.
 *
 * The rule this component is built around: **a claim is checkable when you can
 * see the thing it is about and the thing it is compared against, at the same
 * time.** So every reason carries three parts — the words it points at (lit in
 * the line above), the sentence in plain language, and the two measurements the
 * sentence is comparing. A reason without its measurement is decoration, and a
 * measurement without the words it refers to is a number you are asked to trust.
 */

const STATE_WORD: Record<Note['kind'], string> = {
  helps: 'Helps',
  hurts: 'Hurts',
  'no-effect': 'No effect',
  'not-measured': 'Not measured',
};

/** The model's four states, mapped onto the Badge tones. */
const STATE_TONE: Record<Note['kind'], BadgeTone> = {
  helps: 'helps',
  hurts: 'hurts',
  'no-effect': 'neutral',
  'not-measured': 'unmeasured',
};

/* Booleans dressed as numbers read badly: "this line 1 · your others 0.3". */
const BOOLEAN = /^(has_|ends_|starts_with_|leading_)/;

function fmt(feature: string, v: number, average: boolean): string {
  if (BOOLEAN.test(feature)) {
    if (average) return v === 0 ? 'none of them' : v === 1 ? 'all of them' : `${Math.round(v * 100)}% of them`;
    return v > 0 ? 'yes' : 'no';
  }
  if (Math.abs(v) >= 100 || Number.isInteger(v)) return String(Math.round(v));
  return v.toFixed(Math.abs(v) < 1 ? 2 : 1);
}

/**
 * The measurement under a sentence. Deliberately absent, rather than faked with
 * a zero, when the note carries no numbers — the no-attribution and
 * not-measured notes are about nothing, so there is nothing to show.
 */
function measurement(n: Note): string | null {
  if (n.mine === undefined || n.theirs === undefined) return null;
  const others = fmt(n.feature, n.theirs, true);
  return `this line ${fmt(n.feature, n.mine, false)} · your others ${others}`;
}

function Marked({
  text, marks, lit,
}: { text: string; marks: Mark[]; lit: string | null }) {
  if (!marks.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  marks.forEach((m, k) => {
    if (m.start > at) out.push(text.slice(at, m.start));
    const ring = m.label === 'terminal punctuation';
    out.push(
      <mark
        key={k}
        className={ring ? `${m.kind} ring` : m.kind}
        data-lit={lit === m.feature ? '1' : '0'}
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    at = m.end;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

export function LineBlock({
  line, placing, trainingMedianChars, onDisagree, onInspect, disagreed,
}: {
  line: RankedLine;
  placing: Placing;
  trainingMedianChars: number | null;
  onDisagree?: () => void;
  onInspect?: () => void;
  disagreed?: boolean;
}) {
  /* Which reason the reader is currently pointing at. Drives the highlight in
     the line above, from mouse and from keyboard alike. */
  const [lit, setLit] = useState<string | null>(null);

  const text = line.normalisedText ?? line.text;
  const chars = Math.round(line.features.char_count ?? 0);
  const marked = new Set(line.marks.map((m) => m.feature));

  // The length gauge grows to fit rather than clamping: clamping drew a 100- and
  // a 300-character line at the same place, which is the small lie the whole
  // design exists to avoid.
  const span = trainingMedianChars
    ? Math.max(trainingMedianChars * 1.8, chars * 1.08)
    : null;

  return (
    <article className="line-block">
      <div className="place">
        <div className="inner">
          <span className={`num${placing.exact ? '' : ' range'}`}>{placing.label}</span>
          <span className="who">{idFor(line.index)}</span>
        </div>
      </div>

      <div className="line-body">
        {/* The normalised form: the string the features were measured on, so the
            character count below describes exactly what is shown here. */}
        <p className="subject">
          <Marked text={text} marks={line.marks} lit={lit} />
        </p>

        <div className="why">
          {line.notes.map((n, k) => {
            const measure = measurement(n);
            const traceable = marked.has(n.feature);
            const label = STATE_WORD[n.kind];

            const inner = (
              <>
                <Badge tone={STATE_TONE[n.kind]}>{label}</Badge>
                <span>
                  <span className="why-text">{n.text}</span>
                  {measure && <span className="why-measure">{measure}</span>}
                  {traceable && (
                    <span className="why-measure">
                      <b>marked in the line above</b>
                    </span>
                  )}
                </span>
              </>
            );

            /* Only reasons that actually point at characters become buttons.
               Making an unmarked reason focusable would promise a trace that
               does not exist. */
            return traceable ? (
              <button
                key={k}
                type="button"
                className={`why-row ${n.kind}`}
                onMouseEnter={() => { setLit(n.feature); onInspect?.(); }}
                onMouseLeave={() => setLit(null)}
                onFocus={() => { setLit(n.feature); onInspect?.(); }}
                onBlur={() => setLit(null)}
                aria-label={`${label}: ${n.text}. Highlight the words this refers to.`}
              >
                {inner}
              </button>
            ) : (
              <div key={k} className={`why-row ${n.kind}`}>{inner}</div>
            );
          })}
        </div>

        <div className="length">
          <span className="m m-lower">
            {chars} characters
            {trainingMedianChars !== null
              ? ` · median in the training data was ${trainingMedianChars}`
              : ''}
          </span>
          {span && trainingMedianChars !== null && (
            <div className="length-track" aria-hidden="true">
              <span className="fill" style={{ width: `${(chars / span) * 100}%` }} />
              <span className="median" style={{ left: `${(trainingMedianChars / span) * 100}%` }}>
                <span className="m">median</span>
              </span>
            </div>
          )}
        </div>

        {onDisagree && (
          <div className="dispute">
            <button
              type="button"
              data-done={disagreed ? '1' : '0'}
              onClick={disagreed ? undefined : onDisagree}
              aria-disabled={disagreed ? 'true' : 'false'}
            >
              {disagreed ? 'Logged — thank you' : 'This placing is wrong'}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
