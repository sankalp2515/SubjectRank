'use client';

import { useState } from 'react';

import type { Mark, Note } from '@/lib/attribution';
import type { RankedLine } from '@/lib/model';
import { contenders, idFor, type Placing } from '@/lib/placings';
import { Badge } from '@/components/ui';

/**
 * The ranked rows, the tie strips between them, and the reasoning panel.
 *
 * Two things here are product rules rather than layout choices:
 *
 *  1. **No number is printed beside a line.** The model is pairwise and cannot
 *     produce an absolute score; a "win prob 68%" chip would be the single
 *     claim this product exists not to make.
 *  2. **A tied top gets no winner styling.** The lead chip only appears when
 *     exactly one line is unambiguously first. Crowning one of two lines the
 *     model cannot separate would undo the whole point of the range notation.
 */

const STATE_LABEL: Record<Note['kind'], string> = {
  helps: 'helps',
  hurts: 'hurts',
  'no-effect': 'no effect',
  'not-measured': 'not measured',
};
const STATE_TONE = {
  helps: 'helps', hurts: 'hurts',
  'no-effect': 'neutral', 'not-measured': 'unmeasured',
} as const;

const BOOLEAN = /^(has_|ends_|starts_with_|leading_)/;

function fmt(feature: string, v: number, average: boolean): string {
  if (BOOLEAN.test(feature)) {
    if (average) return v === 0 ? 'none of them' : v === 1 ? 'all of them' : `${Math.round(v * 100)}% of them`;
    return v > 0 ? 'yes' : 'no';
  }
  if (Math.abs(v) >= 100 || Number.isInteger(v)) return String(Math.round(v));
  return v.toFixed(Math.abs(v) < 1 ? 2 : 1);
}

/** Both sides of the comparison the sentence is making, or nothing. */
function measurement(n: Note): string | null {
  if (n.mine === undefined || n.theirs === undefined) return null;
  return `this line ${fmt(n.feature, n.mine, false)} · your others ${fmt(n.feature, n.theirs, true)}`;
}

function Marked({ text, marks, lit }: { text: string; marks: Mark[]; lit: string | null }) {
  if (!marks.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  marks.forEach((m, k) => {
    if (m.start > at) out.push(text.slice(at, m.start));
    out.push(
      <mark key={k} className={m.kind} data-lit={lit === m.feature ? '1' : '0'}>
        {text.slice(m.start, m.end)}
      </mark>,
    );
    at = m.end;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

export function RankedList({
  lines, placings, trainingMedianChars, onDisagree, onInspect, disputed, actions,
}: {
  lines: RankedLine[];
  placings: Map<number, Placing>;
  trainingMedianChars: number | null;
  onDisagree?: () => void;
  onInspect?: () => void;
  disputed?: boolean;
  actions?: React.ReactNode;
}) {
  const [lit, setLit] = useState<string | null>(null);

  const stillRunning = contenders(lines, placings);
  const soleWinner = stillRunning.length === 1 ? stillRunning[0].index : null;
  const top = lines[0];
  const topPlacing = placings.get(top.index);

  return (
    <>
      <div>
        {lines.map((line, i) => {
          const p = placings.get(line.index)!;
          const next = lines[i + 1] ? placings.get(lines[i + 1].index) : null;
          const tied = next ? p.hi >= next.lo && next.hi >= p.lo : false;
          const text = line.normalisedText ?? line.text;
          const chars = Math.round(line.features.char_count ?? 0);
          const span = trainingMedianChars
            ? Math.max(trainingMedianChars * 1.8, chars * 1.08) : null;

          return (
            <div key={line.index}>
              <div className="rank-row">
                <span
                  className={`rank-chip${line.index === soleWinner ? ' lead' : ''}${p.exact ? '' : ' range'}`}
                >
                  {p.label}
                </span>
                <div>
                  <p className="rank-text">
                    {/* The letter is not decoration. The verdict above says
                        things like "B comes first", and without this the reader
                        has no way to tell WHICH line B is -- the rows are in
                        rank order, not input order. A claim the reader cannot
                        trace back to their own text is the failure this product
                        is supposed to avoid. */}
                    <span className="rank-id" aria-label={`Line ${idFor(line.index)}`}>
                      {idFor(line.index)}
                    </span>
                    <Marked text={text} marks={line.marks} lit={lit} />
                  </p>
                  <div className="gauge">
                    <span className="eyebrow">
                      {chars} characters
                      {trainingMedianChars !== null &&
                        ` · median in the training data was ${trainingMedianChars}`}
                    </span>
                    {span && trainingMedianChars !== null && (
                      <div className="gauge-track" aria-hidden="true">
                        <span className="gauge-fill" style={{ width: `${(chars / span) * 100}%` }} />
                        <span className="gauge-median" style={{ left: `${(trainingMedianChars / span) * 100}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {tied && (
                <div className="tie-strip">
                  <span>no clear difference</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="why">
        <h4>
          {soleWinner !== null
            ? `Why ${topPlacing?.label ?? '1st'} came out ahead`
            : 'What the model measured'}
        </h4>
        <div className="why-list">
          {top.notes.map((n, k) => {
            const marked = new Set(top.marks.map((m) => m.feature));
            const traceable = marked.has(n.feature);
            const measure = measurement(n);
            const inner = (
              <>
                <Badge tone={STATE_TONE[n.kind]}>{STATE_LABEL[n.kind]}</Badge>
                <span>
                  <span className="why-text">{n.text}</span>
                  {measure && <span className="why-measure">{measure}</span>}
                </span>
              </>
            );
            /* Only reasons that actually mark characters become buttons —
               making an unmarked reason focusable promises a trace that does
               not exist. */
            return traceable ? (
              <button
                key={k} type="button" className="why-row"
                onMouseEnter={() => { setLit(n.feature); onInspect?.(); }}
                onMouseLeave={() => setLit(null)}
                onFocus={() => { setLit(n.feature); onInspect?.(); }}
                onBlur={() => setLit(null)}
                aria-label={`${STATE_LABEL[n.kind]}: ${n.text}. Highlight the words this refers to.`}
              >
                {inner}
              </button>
            ) : (
              <div key={k} className="why-row">{inner}</div>
            );
          })}
        </div>

        {(onDisagree || actions) && (
          <div className="why-actions">
            {onDisagree && (
              <button
                type="button"
                className="preset"
                onClick={disputed ? undefined : onDisagree}
                aria-disabled={disputed || undefined}
                style={
                  disputed
                    ? { background: 'var(--helps-bg)', color: 'var(--helps-fg)' }
                    : { background: 'var(--ink-brand)', color: 'var(--fg-onInverse)' }
                }
              >
                {disputed ? 'Disagreement noted' : 'Disagree with this ranking'}
              </button>
            )}
            {actions}
          </div>
        )}
      </div>
    </>
  );
}
