import type { ReactNode } from 'react';

import { cx } from '@/design/cx';
import s from './Card.module.css';

export type CardProps = {
  /** Small uppercase label in the header bar. */
  eyebrow?: ReactNode;
  /** Right-aligned header slot — counts, model version, status. */
  aside?: ReactNode;
  footer?: ReactNode;
  tone?: 'raised' | 'sunken';
  /** Remove body padding, for content that manages its own edges. */
  flushBody?: boolean;
  children: ReactNode;
  className?: string;
  /** Renders as <section> with this accessible name when given. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

/**
 * A bordered surface with optional header and footer bars.
 *
 * Composition over configuration: `eyebrow`/`aside`/`footer` are slots that take
 * nodes rather than a growing set of `headerTitle`, `headerCount`,
 * `headerBadgeTone` string props. Slots stop the prop list from growing every
 * time a new header needs something slightly different.
 *
 * @example
 * <Card eyebrow="Your subject lines" aside={`${n} of 5`} flushBody>
 *   <LineInputs />
 * </Card>
 */
export function Card({
  eyebrow, aside, footer, tone = 'raised', flushBody, children, className, ...aria
}: CardProps) {
  const hasHeader = eyebrow !== undefined || aside !== undefined;
  return (
    <section className={cx(s.card, tone === 'sunken' && s.sunken, className)} {...aria}>
      {hasHeader && (
        <header className={s.header}>
          <span className={s.eyebrow}>{eyebrow}</span>
          {aside !== undefined && <span className={s.eyebrow}>{aside}</span>}
        </header>
      )}
      <div className={cx(s.body, flushBody && s.tight)}>{children}</div>
      {footer && <div className={s.footer}>{footer}</div>}
    </section>
  );
}
