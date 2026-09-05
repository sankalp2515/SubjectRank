import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes, letting later ones win conflicts.
 *
 * The design's components are written against this exact helper, so it is
 * carried over rather than replaced with the project's own `cx()`. `cx` composes
 * class strings but does not understand Tailwind's conflict rules — with it,
 * `cn("p-4", "p-6")` would emit both and the winner would depend on stylesheet
 * order rather than call order.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
