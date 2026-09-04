import type { ReactNode } from 'react';

import { cx } from '@/design/cx';
import s from './Badge.module.css';

export type BadgeTone = 'helps' | 'hurts' | 'neutral' | 'unmeasured';

/**
 * A verdict label.
 *
 * The tones map to the model's four states. Every one renders its meaning as a
 * WORD, never as a glyph or colour alone — no legend is needed, and no
 * colour-vision condition can lose the distinction. That is a product
 * requirement here, not a general accessibility nicety.
 *
 * @example <Badge tone="helps">Helps</Badge>
 */
export function Badge({
  tone = 'neutral', children, className,
}: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cx(s.badge, s[tone], className)}>
      <span className={s.text}>{children}</span>
    </span>
  );
}
