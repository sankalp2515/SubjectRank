import { cx } from '@/design/cx';
import { VisuallyHidden } from './VisuallyHidden';
import s from './Skeleton.module.css';

export type SkeletonProps = {
  /** CSS width. Vary it across lines so a paragraph does not look like a table. */
  width?: string;
  height?: string;
  shape?: 'text' | 'line' | 'block';
  className?: string;
};

/**
 * A placeholder with the shape of the content that is coming.
 *
 * `aria-hidden`, always. A screen reader has nothing to gain from six grey
 * rectangles; the announcement belongs on the region's own `aria-busy` or on a
 * single Spinner. Six live placeholders is six interruptions.
 */
export function Skeleton({ width, height, shape = 'line', className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(s.skeleton, s[shape], className)}
      style={{ width, height }}
    />
  );
}

/**
 * The loading shape of one ranked line, matching LineBlock's real layout.
 *
 * It mirrors the real component's proportions on purpose: a skeleton that does
 * not match what replaces it causes exactly the layout shift it exists to
 * prevent.
 */
export function SkeletonLineBlock({ label }: { label?: string }) {
  return (
    <div className={s.lineBlock} aria-hidden="true">
      <Skeleton width="64px" height="16px" />
      <div className={s.lineBody}>
        <Skeleton width="72%" height="22px" />
        <Skeleton width="46%" height="13px" />
        <Skeleton width="58%" height="13px" />
      </div>
      {label && <VisuallyHidden>{label}</VisuallyHidden>}
    </div>
  );
}
