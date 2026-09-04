'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Comparison } from '@/lib/model';
import { placingsFor, verdict } from '@/lib/placings';
import { PRODUCT } from '@/lib/product';
import { Alert, Button, Skeleton } from '@/components/ui';
import { KeepWork } from './AfterResult';
import { ReportOutcome } from './ReportOutcome';
import { RankedList } from './RankedList';

const { minLines, maxLines, maxChars } = PRODUCT.limits;

const track = (name: string) =>
  void fetch(`/api/event?name=${name}`, { method: 'POST' }).catch(() => undefined);

/**
 * Demo presets.
 *
 * Real subject lines, chosen to reach states that are otherwise hard to trigger
 * on demand — a clean separation, a statistical tie, and a line carrying an
 * emoji the model has no opinion about. Nothing here is a fabricated result:
 * every preset is run through the same live model as anything a visitor types.
 */
const PRESETS = [
  {
    id: 'clean',
    label: 'Clear winner',
    lines: [
      'Why your best customers leave',
      'The one chart that explains your churn',
      'We looked at 400 churn surveys. Here is what we found.',
    ],
  },
  {
    id: 'tie',
    label: 'Statistical tie',
    lines: [
      'What nobody tells you about churn',
      'What nobody tells you about renewals',
      'We looked at 400 churn surveys',
    ],
  },
  {
    id: 'emoji',
    label: 'Emoji boundary',
    lines: [
      '5 lessons from rebuilding our billing system',
      'Billing updates you need to know today 🚀',
      'Why we changed our pricing structure last week',
    ],
  },
];

type Props = {
  example: Comparison | null;
  exampleMedianChars: number | null;
  noModelNotice: React.ReactNode;
  excludedFeatures: string[];
};

const EMOJI_FEATURES = ['has_emoji', 'emoji_count', 'emoji_leading', 'emoji_trailing'];

export function Compare({
  example, exampleMedianChars, noModelNotice, excludedFeatures,
}: Props) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Comparison | null>(null);
  const [rankingId, setRankingId] = useState<string | null>(null);
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [medianChars, setMedianChars] = useState<number | null>(exampleMedianChars);
  const [excluded, setExcluded] = useState<string[]>(excludedFeatures);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disputed, setDisputed] = useState(false);
  const verdictRef = useRef<HTMLParagraphElement>(null);

  const shown = result ?? example;
  const isExample = !result && Boolean(example);

  /* One textarea, newline-separated. Pasting three lines from a doc is one
     paste rather than three, which is the whole point of the ten-second job. */
  const lines = useMemo(
    () => text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, maxLines),
    [text],
  );
  const tooLong = lines.find((l) => l.length > maxChars);
  const canCompare = lines.length >= minLines && !tooLong && !busy;

  const fired = useRef<Set<string>>(new Set());
  const once = useCallback((name: string) => {
    if (fired.current.has(name)) return;
    fired.current.add(name);
    track(name);
  }, []);

  useEffect(() => {
    once('landed');
    if (example) once('example_seen');
  }, [example, once]);

  const placings = useMemo(() => (shown ? placingsFor(shown.lines) : null), [shown]);

  const compare = useCallback(async () => {
    track('compare_clicked');
    setBusy(true);
    setError(null);
    setDisputed(false);
    try {
      const res = await fetch('/api/rank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'The comparison did not run. Try again.');
        setResult(null);
        return;
      }
      setResult(body.comparison);
      setRankingId(body.rankingId ?? null);
      setItemIds(body.itemIds ?? []);
      if (Array.isArray(body.excludedFeatures)) setExcluded(body.excludedFeatures);
      if (typeof body.trainingCharMedian === 'number') setMedianChars(body.trainingCharMedian);
      requestAnimationFrame(() => verdictRef.current?.focus());
    } catch {
      setError('Could not reach the server. Check your connection and compare again.');
    } finally {
      setBusy(false);
    }
  }, [lines]);

  const dispute = async () => {
    setDisputed(true);
    if (!rankingId) return;
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rankingId }),
    }).catch(() => undefined);
  };

  const emojiDropped = EMOJI_FEATURES.some((f) => excluded.includes(f));

  return (
    <>
      <section className="panel panel-gap" aria-labelledby="compare-heading">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="compare-heading">Compare the lines you wrote</h2>
            <p className="panel-sub">
              Paste 2–5 lines, one per line. It ranks them against each other and
              shows its working.
            </p>
          </div>
          <span className="pill">
            <span className="pill-dot" aria-hidden="true" />
            {example ? 'Model live' : 'No model deployed'}
          </span>
        </div>

        <div style={{ marginTop: 'var(--space-6)' }}>
          <div className="presets">
            <span className="presets-label">Try one:</span>
            {PRESETS.map((p) => (
              <button
                key={p.id} type="button" className="preset"
                onClick={() => setText(p.lines.join('\n'))}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="sr-only" htmlFor="lines">Your subject lines, one per line</label>
          <textarea
            id="lines"
            className="lines-input"
            rows={4}
            value={text}
            onFocus={() => once('input_focused')}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Paste 2–5 subject lines, one per line…'}
            aria-describedby="lines-meta"
          />

          <div className="lines-meta" id="lines-meta">
            <span>
              {lines.length} of {maxLines} lines
              {lines.length > 0 && lines.length < minLines && ' · two minimum, it compares them against each other'}
            </span>
            <span>Lines are stored and become training data. That is how this stays free.</span>
          </div>

          {tooLong && (
            <Alert tone="danger" title="One line is too long" className="panel-gap">
              That line is {tooLong.length} characters; the limit is {maxChars}. Shorten it and compare again.
            </Alert>
          )}

          <div className="lines-actions">
            <Button size="lg" block onClick={() => void compare()} disabled={!canCompare}
                    loading={busy} loadingLabel="Comparing">
              Compare
            </Button>
          </div>
        </div>
      </section>

      {error && (
        <Alert tone="danger" title="Comparison did not run" className="panel-gap">
          {error}
        </Alert>
      )}

      {/* Skeleton in the shape of the answer, sized from the real line count, so
          the page does not jump when results land. */}
      {busy && (
        <section className="panel panel-gap" aria-busy="true" aria-live="polite">
          <span className="sr-only">Comparing {lines.length} subject lines</span>
          {lines.map((_, i) => (
            <div key={i} className="rank-row">
              <Skeleton width="46px" height="32px" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <Skeleton width={`${70 - i * 8}%`} height="18px" />
                <Skeleton width="45%" height="12px" />
              </div>
            </div>
          ))}
        </section>
      )}

      {!shown && !error && !busy && noModelNotice}

      {shown && placings && !busy && (
        <section className="panel panel-gap" aria-labelledby="result-heading">
          <div className="panel-head">
            <h3 className="panel-title" id="result-heading">Comparison</h3>
            <span className="eyebrow">
              {isExample ? 'worked example · ' : ''}model {shown.modelVersion}
            </span>
          </div>

          <p className="verdict" ref={verdictRef} tabIndex={-1}>
            {verdict(shown.lines, placings)}
          </p>

          <div style={{ marginTop: 'var(--space-5)' }}>
            <RankedList
              lines={shown.lines}
              placings={placings}
              trainingMedianChars={medianChars}
              onDisagree={isExample ? undefined : () => void dispute()}
              onInspect={() => once('attribution_expanded')}
              disputed={disputed}
            />
          </div>

          {excluded.length > 0 && (
            <div className="unmeasured-block">
              <span className="eyebrow">Not measured</span>
              <p>
                {excluded.length === 1 ? 'One property was' : `${excluded.length} properties were`}
                {' '}left out of this model entirely: the 2013–2015 headlines it learned
                from barely contain them, and a coefficient fitted on a handful of
                examples is noise with a confident sign on it.
                {emojiDropped && (
                  <> <strong>Emoji are the main one.</strong> This model has no opinion
                  about your emoji, and you should not read its silence as approval.</>
                )}
              </p>
            </div>
          )}

          <div className="two-col">
            <ReportOutcome
              lines={shown.lines}
              placings={placings}
              rankingId={isExample ? null : rankingId}
              itemIds={itemIds}
            />
            {!isExample && <KeepWork />}
          </div>
        </section>
      )}
    </>
  );
}
