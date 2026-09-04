'use client';

import { createContext, useContext, useId } from 'react';
import type { ReactNode } from 'react';

import { cx, describedBy } from '@/design/cx';
import s from './Field.module.css';

type FieldContextValue = {
  /** id for the control itself */
  controlId: string;
  /** value for the control's aria-describedby, or undefined if nothing to point at */
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Read the wiring the enclosing Field set up.
 *
 * Returns null outside a Field so a control can still be used standalone —
 * throwing would make `<TextInput>` unusable in the one-off cases where a label
 * genuinely lives elsewhere.
 */
export const useField = () => useContext(FieldContext);

export type FieldProps = {
  label: ReactNode;
  /** Persistent helper text. Not a placeholder — placeholders vanish on focus. */
  hint?: ReactNode;
  /** When set, the field renders as invalid and the message is announced. */
  error?: string | null;
  required?: boolean;
  /** Renders "optional" next to the label. Marking the smaller set is clearer. */
  optional?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * Label, hint, error and ARIA wiring for one control.
 *
 * This is the primitive that pays for itself fastest. Doing it by hand means
 * remembering, every single time: a real `<label htmlFor>`, an `id` on the
 * control, `aria-describedby` pointing at BOTH the hint and the error,
 * `aria-invalid`, and `role="alert"` on the message. Miss the
 * `aria-describedby` and nothing looks wrong — the field renders correctly and
 * a screen reader simply never reads the error out.
 *
 * Errors render *next to the field*, never only in a summary at the top of the
 * form, so the person can see what to fix where they are looking.
 *
 * @example
 * <Field label="Clicks" hint="what the training data measured" optional>
 *   <TextInput inputMode="numeric" value={clicks} onChange={...} />
 * </Field>
 *
 * <Field label="Email" error={emailError} required>
 *   <TextInput type="email" autoComplete="email" />
 * </Field>
 */
export function Field({
  label, hint, error, required = false, optional = false, children, className,
}: FieldProps) {
  const base = useId();
  const controlId = `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;

  const ctx: FieldContextValue = {
    controlId,
    describedBy: describedBy(!!hint && hintId, !!error && errorId),
    invalid: Boolean(error),
    required,
  };

  return (
    <FieldContext.Provider value={ctx}>
      <div className={cx(s.field, error && s.invalid, className)}>
        <label className={s.label} htmlFor={controlId}>
          {label}
          {required && <span className={s.required}>required</span>}
          {optional && <span className={s.optional}>optional</span>}
        </label>

        {children}

        {/*
          Hint stays visible when there is an error. Replacing it with the error
          removes the instruction at exactly the moment the person needs it most.
        */}
        {hint && <p id={hintId} className={s.hint}>{hint}</p>}

        {/*
          Always in the DOM, toggled with `hidden`. A conditionally *mounted*
          alert is announced inconsistently across screen readers, because the
          live region has to exist before the text lands in it.
        */}
        <p id={errorId} className={s.error} role="alert" hidden={!error}>
          {error}
        </p>
      </div>
    </FieldContext.Provider>
  );
}

/** A group of related controls — radios, chips — with the same wiring. */
export function FieldGroup({
  label, hint, error, required = false, optional = false, children, className,
}: FieldProps) {
  const base = useId();
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;

  return (
    <fieldset
      className={cx(s.field, s.group, error && s.invalid, className)}
      aria-describedby={describedBy(!!hint && hintId, !!error && errorId)}
      aria-invalid={error ? true : undefined}
    >
      {/* <legend> rather than <label>: a group of controls has no single control
          for a label to point at, and screen readers announce a legend once for
          the whole group instead of repeating it per option. */}
      <legend className={s.label}>
        {label}
        {required && <span className={s.required}>required</span>}
        {optional && <span className={s.optional}>optional</span>}
      </legend>

      {children}

      {hint && <p id={hintId} className={s.hint}>{hint}</p>}
      <p id={errorId} className={s.error} role="alert" hidden={!error}>{error}</p>
    </fieldset>
  );
}
