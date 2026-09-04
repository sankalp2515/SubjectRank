'use client';

import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

import { cx } from '@/design/cx';
import { useField } from './Field';
import s from './TextInput.module.css';

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** `prominent` is for the subject lines: the visitor's own words, set large. */
  variant?: 'default' | 'prominent' | 'bare';
};

/**
 * A text input that inherits its accessibility wiring from an enclosing Field.
 *
 * Inside a `<Field>` it picks up `id`, `aria-describedby`, `aria-invalid` and
 * `required` automatically. Outside one it behaves like a plain input, so the
 * handful of cases with a label elsewhere are still possible.
 *
 * Props passed explicitly always win over the context, because the escape hatch
 * has to exist — a component that cannot be overridden gets forked instead.
 *
 * @example
 * <Field label="Email" error={err}><TextInput type="email" /></Field>
 * <TextInput variant="prominent" aria-label="Subject line A" />
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ variant = 'default', className, ...rest }, ref) {
    const field = useField();

    return (
      <input
        ref={ref}
        // Context first, explicit props second — `rest` is spread after, so a
        // caller-supplied id or aria-describedby overrides the Field's.
        id={field?.controlId}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        required={field?.required || undefined}
        {...rest}
        className={cx(
          s.input,
          variant === 'prominent' && s.prominent,
          variant === 'bare' && s.bare,
          className,
        )}
      />
    );
  },
);
