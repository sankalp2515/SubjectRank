import type { ElementType, ReactNode } from 'react';

import s from './VisuallyHidden.module.css';

/**
 * Visible to assistive technology, invisible on screen.
 *
 * Uses the clip-rect technique rather than `display:none` or `visibility:hidden`
 * — both of those remove the element from the accessibility tree too, which is
 * the opposite of what this is for.
 */
export function VisuallyHidden({
  as: Tag = 'span', children, ...rest
}: { as?: ElementType; children: ReactNode } & Record<string, unknown>) {
  return <Tag className={s.hidden} {...rest}>{children}</Tag>;
}
