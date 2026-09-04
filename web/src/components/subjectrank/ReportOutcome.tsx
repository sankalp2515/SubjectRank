'use client';

import { useEffect, useState } from 'react';

import type { RankedLine } from '@/lib/model';
import { idFor, type Placing } from '@/lib/placings';
import {
  Alert, Button, ChipGroup, ChoiceList, Field, FieldGroup, TextInput,
} from '@/components/ui';
import s from './ReportOutcome.module.css';

/**
 * "You sent one of these. What happened?"
 *
 * The only path to testing the transfer hypothesis (D-011, Q-003), so the form
 * is built to be answered in under fifteen seconds by someone who is not being
 * paid to fill it in: one required choice, one number, everything else optional
 * and visibly so. No login — the signed session cookie already identifies them.
 *
 * **Clicks are asked for first, and that ordering is the argument.** Apple Mail
 * Privacy Protection pre-fetches tracking pixels, so an unknowable share of any
 * reported "open" is a machine rather than a reader. Clicks are what the
 * Upworthy data measured, so collecting both keeps a reported outcome and a
 * training label commensurable (Q-004). That reasoning is in the interface,
 * briefly, or the extra field just looks like nosiness.
 */

/**
 * The chips answer a vague question, so each band carries its midpoint. The
 * midpoint is derived, not stated, so the band the person actually chose is
 * preserved verbatim in `notes` alongside the number computed from it.
 */
const MPP_BANDS = [
  { value: 'unknown', label: 'no idea', share: undefined },
  { value: 'under_quarter', label: 'under a quarter', share: 0.125 },
  { value: 'about_half', label: 'about half', share: 0.5 },
  { value: 'most', label: 'most of it', share: 0.8 },
] as const;

type BandId = (typeof MPP_BANDS)[number]['value'];

type Errors = { sent?: string; numbers?: string; submit?: string };

export function ReportOutcome({
  lines, placings, rankingId, itemIds,
}: {
  lines: RankedLine[];
  placings: Map<number, Placing>;
  rankingId: string | null;
  itemIds: string[];
}) {
  const [sent, setSent] = useState<number | null>(null);
  const [clicks, setClicks] = useState('');
  const [opens, setOpens] = useState('');
  const [listSize, setListSize] = useState('');
  const [band, setBand] = useState<BandId>('unknown');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!rankingId) return;
    fetch('/api/event?name=outcome_prompt_shown', { method: 'POST' })
      .catch(() => undefined);
  }, [rankingId]);

  if (!rankingId) return null;

  /** undefined = not given, NaN = given but not a whole number ≥ 0. */
  const whole = (v: string) => {
    if (v.trim() === '') return undefined;
    const n = Number(v.replace(/[,\s]/g, ''));
    return Number.isFinite(n) && n >= 0 && Number.isInteger(n) ? n : NaN;
  };

  const submit = async () => {
    const c = whole(clicks);
    const o = whole(opens);
    const l = whole(listSize);

    // Every problem at once, each next to the field it belongs to. Validating
    // one at a time makes the person submit repeatedly to discover the rest.
    const next: Errors = {};
    if (sent === null) {
      next.sent = 'Pick which line you sent — the numbers need something to attach to.';
    }
    if (Number.isNaN(c) || Number.isNaN(o) || Number.isNaN(l)) {
      next.numbers = 'Whole numbers only, zero or above.';
    } else if (c === undefined && o === undefined) {
      next.numbers = 'Add clicks or opens. Either one on its own is enough.';
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    setState('busy');
    const chosen = MPP_BANDS.find((b) => b.value === band)!;
    try {
      const res = await fetch('/api/outcome', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rankingId,
          sentItemId: itemIds[sent!],
          clicks: c, opens: o, listSize: l,
          appleMailShareEstimate: chosen.share,
          notes: `apple_mail_share_band=${chosen.value}`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrors({ submit: body.error ?? 'That did not record. Try again.' });
        setState('idle');
        return;
      }
      setState('done');
    } catch {
      setErrors({ submit: 'Could not reach the server. Check your connection and record it again.' });
      setState('idle');
    }
  };

  if (state === 'done') {
    return (
      <div className={s.panel}>
        {/* The action was called "Record it", so this says "Recorded". */}
        <Alert tone="success" title="What happened" live="polite">
          <strong className={s.doneTitle}>Recorded.</strong>
          <p className={s.doneBody}>
            That is the most useful thing anyone gives this tool. Every reported
            outcome is one more piece of evidence about whether effects learned
            from 2015 headlines say anything about 2026 email — which is
            currently an argument rather than a finding.
          </p>
        </Alert>
      </div>
    );
  }

  const ordered = lines.slice().sort((a, b) => a.rank - b.rank);

  return (
    <div className={s.panel}>
      <span className={s.eyebrow}>What happened</span>
      <h3 className={s.heading}>Sent one of these? Say how it did.</h3>
      <p className={s.intro}>
        Under fifteen seconds, no account. This is the only way the ranking above
        gets tested against real email instead of 2015 headlines.
      </p>

      <div className={s.fields}>
        <FieldGroup label="Which one did you send?" required error={errors.sent}>
          <ChoiceList
            value={sent}
            onChange={(v) => { setSent(v); setErrors((e) => ({ ...e, sent: undefined })); }}
            options={ordered.map((l) => ({
              value: l.index,
              label: l.normalisedText ?? l.text,
              meta: `we placed this ${placings.get(l.index)?.label ?? l.rank}`,
            }))}
          />
        </FieldGroup>

        <FieldGroup
          label="What happened?"
          optional
          hint="Either number is enough."
          error={errors.numbers}
        >
          <div className={s.two}>
            <Field label="Clicks" hint="what the training data measured">
              <TextInput
                inputMode="numeric"
                autoComplete="off"
                value={clicks}
                onChange={(e) => setClicks(e.target.value)}
                placeholder="e.g. 38"
              />
            </Field>
            <Field label="Opens" hint="distorted by Apple Mail pre-fetch">
              <TextInput
                inputMode="numeric"
                autoComplete="off"
                value={opens}
                onChange={(e) => setOpens(e.target.value)}
                placeholder="e.g. 412"
              />
            </Field>
          </div>

          <Field label="List size" optional className={s.listSize}>
            <TextInput
              inputMode="numeric"
              autoComplete="off"
              value={listSize}
              onChange={(e) => setListSize(e.target.value)}
              placeholder="how many it went to"
            />
          </Field>
        </FieldGroup>

        <FieldGroup
          label="Roughly what share of your list is Apple Mail?"
          optional
          hint={
            'Apple Mail pre-fetches tracking pixels, so a share of your opens are ' +
            'machines rather than readers. Knowing roughly how many keeps your ' +
            'number interpretable later. It is not used to judge your list.'
          }
        >
          <ChipGroup
            value={band}
            onChange={setBand}
            options={MPP_BANDS.map(({ value, label }) => ({ value, label }))}
          />
        </FieldGroup>
      </div>

      {errors.submit && (
        <Alert tone="danger" title="Not recorded" className={s.submitError}>
          {errors.submit}
        </Alert>
      )}

      <div className={s.actions}>
        <Button onClick={() => void submit()} loading={state === 'busy'} loadingLabel="Recording">
          Record it
        </Button>
        <span className={s.footnote}>no account needed · delete it any time</span>
      </div>
    </div>
  );
}
