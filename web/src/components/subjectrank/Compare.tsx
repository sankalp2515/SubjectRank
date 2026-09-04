'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { emojiWasDropped } from '@/lib/feature-groups';
import type { Comparison } from '@/lib/model';
import { idFor, placingsFor, verdict } from '@/lib/placings';
import { PRODUCT } from '@/lib/product';
import { KeepWork } from './AfterResult';
import { ReportOutcome } from './ReportOutcome';
import {
  Alert, Button, Card, SkeletonLineBlock, TextInput, VisuallyHidden,
} from '@/components/ui';
import cs from './Compare.module.css';
import { PlacingList } from './PlacingList';
import { Scale } from './Scale';

const { minLines, maxLines, maxChars } = PRODUCT.limits;

/** Closed enum, matched to src/app/api/event. Unknown names are dropped there. */
const track = (name: string) =>
  void fetch(`/api/event?name=${name}`, { method: 'POST' }).catch(() => undefined);

type Props = {
  /** A real comparison computed at build time from the deployed model, or null. */
  example: Comparison | null;
  exampleMedianChars: number | null;
  /** Rendered in place of the example when no model was deployed at build time. */
  noModelNotice: React.ReactNode;
  excludedFeatures: string[];
};

export function Compare({
  example, exampleMedianChars, noModelNotice, excludedFeatures,
}: Props) {
  const [lines, setLines] = useState<string[]>(['', '']);
  const [result, setResult] = useState<Comparison | null>(null);
  const [rankingId, setRankingId] = useState<string | null>(null);
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [medianChars, setMedianChars] = useState<number | null>(exampleMedianChars);
  const [excluded, setExcluded] = useState<string[]>(excludedFeatures);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disputed, setDisputed] = useState<Set<number>>(new Set());
  const verdictRef = useRef<HTMLParagraphElement>(null);

  /* Yours if you have run one, otherwise the worked example. The example is a
     real comparison from the deployed model, never an illustration. */
  const shown = result ?? example;
  const isExample = !result && Boolean(example);

  /* Memoised because `compare` closes over it. A fresh array on every render
     rebuilt that callback on every keystroke, which made its useCallback a
     no-op and handed every child a new function identity for nothing. */
  const filled = useMemo(() => lines.map((l) => l.trim()).filter(Boolean), [lines]);
  const canCompare = filled.length >= minLines && !busy;

  /* The funnel. Each step fires once per mount; `landed` and `example_seen`
     together are what separate "arrived" from "saw a real ranking without
     typing", which is the claim requirement 2 makes. */
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

  const placings = useMemo(
    () => (shown ? placingsFor(shown.lines) : null),
    [shown],
  );

  const setLine = (i: number, v: string) =>
    setLines((prev) => prev.map((l, k) => (k === i ? v.slice(0, maxChars) : l)));
  const addLine = () => setLines((prev) => (prev.length < maxLines ? [...prev, ''] : prev));
  const dropLine = (i: number) =>
    setLines((prev) => (prev.length > minLines ? prev.filter((_, k) => k !== i) : prev));

  const compare = useCallback(async () => {
    track('compare_clicked');
    setBusy(true);
    setError(null);
    setDisputed(new Set());
    try {
      const res = await fetch('/api/rank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines: filled }),
      });
      const body = await res.json();
      if (!res.ok) {
        // What happened and how to fix it. No apology.
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
  }, [filled]);

  const dispute = async (lineIndex: number) => {
    setDisputed((prev) => new Set(prev).add(lineIndex));
    if (!rankingId) return;
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rankingId, rankingItemId: itemIds[lineIndex] }),
    }).catch(() => undefined);
  };

  /* Emoji are the case D-012 was written for, and the one people will look for.
     The list itself lives in lib/feature-groups so the per-line note and this
     panel cannot end up disagreeing about which features it covers. */
  const emojiDropped = emojiWasDropped(excluded);

  return (
    <>
      <Card
        eyebrow={<span id="yours">Your subject lines</span>}
        aside={`${filled.length} of ${maxLines} filled in`}
        aria-labelledby="yours"
        flushBody
        className={cs.sheet}
        footer={
          <>
            <Button onClick={() => void compare()} disabled={!canCompare}
                    loading={busy} loadingLabel="Comparing">
              Compare
            </Button>
            {lines.length < maxLines && (
              <Button tone="secondary" onClick={addLine}>Add a line</Button>
            )}
            {filled.length < minLines && (
              <span className={cs.note}>
                Two lines minimum. It compares them against each other, so one on
                its own has nothing to be compared to.
              </span>
            )}
          </>
        }
      >
        {lines.map((line, i) => (
          <div className={cs.row} key={i}>
            <span className={cs.tag} aria-hidden="true">{idFor(i)}</span>
            <TextInput
              variant="bare"
              id={`line-${i}`}
              aria-label={`Subject line ${idFor(i)}`}
              value={line}
              maxLength={maxChars}
              autoComplete="off"
              placeholder={i === 0 ? 'Paste a subject line' : 'And one to compare it against'}
              onFocus={() => once('input_focused')}
              onChange={(e) => setLine(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canCompare) void compare(); }}
            />
            {lines.length > minLines ? (
              <button type="button" className={cs.kill} onClick={() => dropLine(i)}>
                <span aria-hidden="true">&times;</span>
                <VisuallyHidden>Remove subject line {idFor(i)}</VisuallyHidden>
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
          </div>
        ))}
      </Card>

      {error && (
        <Alert tone="danger" title="Comparison did not run" className={cs.gap}>
          {error}
        </Alert>
      )}

      {/*
        Loading is a skeleton in the shape of the answer, not a spinner in an
        empty space. It reserves the height the results will occupy, so the page
        does not jump when they land — and it shows how many lines are coming,
        which a spinner cannot.
      */}
      {busy && (
        <section className={cs.loading} aria-busy="true" aria-live="polite">
          <VisuallyHidden>Comparing {filled.length} subject lines</VisuallyHidden>
          {filled.map((_, i) => <SkeletonLineBlock key={i} />)}
        </section>
      )}

      {!shown && !error && !busy && noModelNotice}

      {shown && placings && !busy && (
        <section className="result" aria-labelledby="comparison-heading">
          <div className="result-head">
            {/* The button said Compare, so this says Comparison. Same word, whole flow. */}
            <span className="m" id="comparison-heading">
              {isExample ? 'Comparison — worked example' : 'Comparison'}
            </span>
            <span className="m">
              model {shown.modelVersion} · spec v{shown.featureSpecVersion}
            </span>
          </div>

          <p className="verdict" ref={verdictRef} tabIndex={-1}>
            {verdict(shown.lines, placings)}
          </p>

          {isExample && (
            <p className="m m-lower" style={{ marginTop: 10 }}>
              Three lines run through the live model, so you can see the shape of an
              answer before you give it anything. Yours replaces this.
            </p>
          )}

          <Scale lines={shown.lines} placings={placings} />

          <PlacingList
            lines={shown.lines}
            placings={placings}
            trainingMedianChars={medianChars}
            onDisagree={isExample ? undefined : (i) => void dispute(i)}
            onInspect={() => once('attribution_expanded')}
            disputed={disputed}
          />

          {/*
            The fourth state, standing rather than per-line. Silence about a
            property gets filled in by the reader, so what the model has no
            opinion about is said out loud even when nothing triggered it.
          */}
          {excluded.length > 0 && (
            <div className="nothing">
              <span className="m">Not measured</span>
              <p>
                {excluded.length === 1 ? 'One property was' : `${excluded.length} properties were`}
                {' '}left out of this model entirely: the 2013&ndash;2015 headlines it
                learned from barely contain them, and a coefficient fitted on a
                handful of examples is noise with a confident sign on it.
                {emojiDropped && (
                  <>
                    {' '}
                    <strong>Emoji are the main one.</strong> This model has no
                    opinion about your emoji, and you should not read its silence
                    as approval.
                  </>
                )}
              </p>
            </div>
          )}

          <div className={`after${isExample ? ' single' : ''}`}>
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
