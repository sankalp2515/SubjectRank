import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { variants } from '@/design/cx';
import { Spinner } from './Spinner';
import s from './Button.module.css';

const button = variants(
  s.button,
  {
    tone: {
      primary: s.primary,
      secondary: s.secondary,
      ghost: s.ghost,
      danger: s.danger,
      link: s.link,
    },
    size: { sm: s.sm, md: s.md, lg: s.lg },
  },
  { tone: 'primary', size: 'md' },
);

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
    tone?: ButtonTone;
    size?: ButtonSize;
    /** Full-width. Used on phones, where a 44px target should span the row. */
    block?: boolean;
    /**
     * Shows a spinner, disables the button, and sets aria-busy — one prop for
     * all three, because doing two of the three is the common bug. The label
     * stays in the DOM (hidden) so the button keeps its width.
     */
    loading?: boolean;
    /** Announced while `loading`. Defaults to the button's own label. */
    loadingLabel?: string;
    /**
     * Explicit, and defaulted to "button". An unset `type` inside a <form>
     * submits it — the single most common accidental-submit bug in React.
     */
    type?: 'button' | 'submit' | 'reset';
    children: ReactNode;
  };

/**
 * The only button in the app.
 *
 * Three things it guarantees that a raw <button> does not:
 *
 *  - **44px minimum height, always.** Not a style prop. WCAG 2.5.5 is not
 *    something a caller should be able to opt out of by passing size="sm".
 *  - **Loading is one prop.** `loading` disables, sets `aria-busy`, swaps in a
 *    spinner and preserves the width. Every place that previously did
 *    `{busy ? 'Comparing…' : 'Compare'}` also had to remember `disabled`, and
 *    the label swap changed the button's width mid-click.
 *  - **`type="button"` by default**, so dropping one inside a form later does
 *    not silently turn it into a submit.
 *
 * @example
 * <Button onClick={run} loading={busy} loadingLabel="Comparing">Compare</Button>
 * <Button tone="secondary" size="sm">Add a line</Button>
 * <Button tone="link" onClick={reset}>Start over</Button>
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { tone, size, block, loading = false, loadingLabel, disabled,
    className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      // Disabled while loading so a double-click cannot fire the action twice —
      // the reason this is bundled into one prop rather than left to callers.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading ? 'true' : undefined}
      className={button({ tone, size, className: [block && s.block, className] })}
    >
      <span className={s.label}>{children}</span>
      {loading && (
        <span className={s.spinnerSlot}>
          <Spinner
            size="sm"
            label={loadingLabel ?? (typeof children === 'string' ? children : 'Working')}
          />
        </span>
      )}
    </button>
  );
});
