'use client';

import { useState } from 'react';

import { useEffect } from 'react';

import { Alert, Button, Field, TextInput } from '@/components/ui';
import s from './AfterResult.module.css';

/**
 * Offered once a comparison is on screen, and never before: keeping the work,
 * and the delete control that is the other half of storing it.
 *
 * Panels on the page. Neither is a modal, neither blocks the result, and neither
 * is a gate — the comparison already happened. Reporting an outcome lives in
 * ./ReportOutcome.
 */

/**
 * The account offer. Rendered only once a comparison is on screen, never before.
 *
 * Framed as keeping the work, because that is literally what it does: nothing on
 * this page was gated behind it, and the comparison the visitor is looking at
 * already ran.
 */
export function KeepWork() {
  useEffect(() => {
    fetch('/api/event?name=account_prompt_shown', { method: 'POST' })
      .catch(() => undefined);
  }, []);

  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const attach = async () => {
    setState('busy');
    setError(null);
    try {
      const res = await fetch('/api/account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'That did not save. Try again.');
        setState('idle');
        return;
      }
      setState('done');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setState('idle');
    }
  };

  return (
    <div className={s.panel}>
      <span className={s.eyebrow}>Keep this</span>
      <h3 className={s.heading}>
        Your comparisons are saved to this browser. Want them to outlive it?
      </h3>
      {/* States exactly what the endpoint does. It attaches an address to the
          identity this browser already has — it does not sign anyone in and it
          does not send mail, so this copy must not promise either. */}
      <p className={s.intro}>
        Everything above already worked without an account and always will.
        Leaving an address attaches your comparisons to you instead of to a
        cookie, so clearing this browser does not lose them.
      </p>

      {state === 'done' ? (
        <Alert tone="success" title="Attached" live="polite" className={s.result}>
          Your comparisons are yours now, not this browser&rsquo;s.
        </Alert>
      ) : (
        <>
          <div className={s.form}>
            <Field label="Email" error={error}>
              <TextInput
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                placeholder="you@yourlist.com"
              />
            </Field>
          </div>
          <div className={s.actions}>
            <Button
              onClick={() => void attach()}
              loading={state === 'busy'}
              loadingLabel="Saving"
              disabled={!email.trim()}
            >
              Keep my comparisons
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One action, one canonical place: the footer, beside the sentence explaining why
 * the text is kept in the first place.
 *
 * It used to also live in a panel above, which meant the page made the same
 * disclosure twice in slightly different words — and two versions of a promise
 * about someone's data is one version too many.
 */
export function DeleteMine() {
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  const wipe = async () => {
    setState('busy');
    await fetch('/api/delete', { method: 'POST' }).catch(() => undefined);
    setState('done');
    setConfirming(false);
  };

  if (state === 'done') {
    return (
      <Alert tone="success" title="Deleted" live="polite" className={s.result}>
        Nothing of yours is left.
      </Alert>
    );
  }

  return (
    <div className={s.footActions}>
      {confirming ? (
        <>
          <Button tone="danger" onClick={() => void wipe()} loading={state === 'busy'}
                  loadingLabel="Deleting">
            Yes, delete all of it
          </Button>
          <Button tone="link" onClick={() => setConfirming(false)}>Keep it</Button>
        </>
      ) : (
        <Button tone="secondary" onClick={() => setConfirming(true)}>
          Delete everything I have submitted
        </Button>
      )}
    </div>
  );
}
