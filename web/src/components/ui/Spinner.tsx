import { cx } from '@/design/cx';
import { VisuallyHidden } from './VisuallyHidden';
import s from './Spinner.module.css';

export type SpinnerProps = {
  size?: 'sm' | 'md';
  /**
   * Announced to screen readers. Required rather than optional: a spinner with
   * no accessible name is a decorative div as far as assistive tech is
   * concerned, and the user is told nothing is happening.
   */
  label: string;
  className?: string;
};

/**
 * An indeterminate progress indicator.
 *
 * `role="status"` + `aria-live="polite"` so the label is announced when it
 * appears, without interrupting whatever is being read. Not `role="alert"` —
 * "loading" is not an alert, and using one makes every fetch rude.
 */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  return (
    <span role="status" aria-live="polite" className={className}>
      <span className={cx(s.spinner, s[size])} aria-hidden="true" />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
