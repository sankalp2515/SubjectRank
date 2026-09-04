import type { ReactNode } from 'react';

import { cx } from '@/design/cx';
import s from './Alert.module.css';

export type AlertTone = 'info' | 'danger' | 'success' | 'unmeasured';

export type AlertProps = {
  tone?: AlertTone;
  /** Short uppercase label. Says what KIND of message this is. */
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  /**
   * Override the announcement behaviour.
   *
   * Derived from `tone` by default: `danger` gets role="alert" (interrupts),
   * `success` gets role="status" (polite), the rest are silent. Passing "none"
   * is for an alert that is part of the page's initial content — announcing
   * something that was there before the user arrived is noise.
   */
  live?: 'assertive' | 'polite' | 'none';
};

/**
 * A bordered message. Info, failure, success, or the absence of an opinion.
 *
 * The live-region behaviour is derived from tone rather than left to the
 * caller, because the common mistakes are (a) an error nobody announces and
 * (b) static page copy wrapped in role="alert" that shouts on every render.
 *
 * @example
 * <Alert tone="danger" title="Comparison did not run">{error}</Alert>
 * <Alert tone="unmeasured" title="Not measured" live="none">…</Alert>
 */
export function Alert({
  tone = 'info', title, children, actions, className, live,
}: AlertProps) {
  const mode = live ?? (tone === 'danger' ? 'assertive' : tone === 'success' ? 'polite' : 'none');

  return (
    <div
      className={cx(s.alert, s[tone], className)}
      role={mode === 'assertive' ? 'alert' : mode === 'polite' ? 'status' : undefined}
      aria-live={mode === 'none' ? undefined : mode}
    >
      {title && <span className={s.title}>{title}</span>}
      <div className={s.body}>{children}</div>
      {actions && <div className={s.actions}>{actions}</div>}
    </div>
  );
}
