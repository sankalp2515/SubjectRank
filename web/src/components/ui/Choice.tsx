'use client';

import { useId } from 'react';
import type { ReactNode } from 'react';

import { cx } from '@/design/cx';
import s from './Choice.module.css';

export type ChoiceOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  /** Secondary line — a rank, a hint, a count. */
  meta?: ReactNode;
  disabled?: boolean;
};

export type ChoiceListProps<T extends string | number> = {
  name?: string;
  value: T | null;
  onChange: (value: T) => void;
  options: ChoiceOption<T>[];
  className?: string;
};

/**
 * A single-select list where the entire row is the hit target.
 *
 * Native `<input type="radio">` under the hood, so arrow-key navigation, form
 * association and screen-reader group semantics all come for free. A div with
 * `role="radio"` and a click handler has to reimplement every one of those, and
 * usually reimplements two of them.
 *
 * Wrap in `<FieldGroup>` for the label, hint and error.
 *
 * @example
 * <FieldGroup label="Which one did you send?" required>
 *   <ChoiceList value={sent} onChange={setSent} options={lines.map(...)} />
 * </FieldGroup>
 */
export function ChoiceList<T extends string | number>({
  name, value, onChange, options, className,
}: ChoiceListProps<T>) {
  const auto = useId();
  const groupName = name ?? auto;

  return (
    <div className={cx(s.list, className)}>
      {options.map((opt) => (
        <label key={String(opt.value)} className={s.choice}>
          <input
            className={s.radio}
            type="radio"
            name={groupName}
            value={String(opt.value)}
            checked={value === opt.value}
            disabled={opt.disabled}
            onChange={() => onChange(opt.value)}
          />
          <span className={s.choiceBody}>
            <span className={s.choiceLabel}>{opt.label}</span>
            {opt.meta && <span className={s.choiceMeta}>{opt.meta}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

export type ChipGroupProps<T extends string> = {
  name?: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
};

/**
 * Horizontal single-select for a small set of short answers.
 *
 * Still radios. The chip look is styling on top of correct semantics, not a
 * replacement for them — which is why it keeps keyboard support and announces
 * as a group.
 *
 * @example
 * <FieldGroup label="Roughly what share is Apple Mail?" optional>
 *   <ChipGroup value={band} onChange={setBand} options={BANDS} />
 * </FieldGroup>
 */
export function ChipGroup<T extends string>({
  name, value, onChange, options, className,
}: ChipGroupProps<T>) {
  const auto = useId();
  const groupName = name ?? auto;

  return (
    <div className={cx(s.chips, className)}>
      {options.map((opt) => (
        <label key={opt.value} className={s.chip}>
          <input
            type="radio"
            name={groupName}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          <span className={s.chipLabel}>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}
