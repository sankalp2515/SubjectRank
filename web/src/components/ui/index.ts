/**
 * The UI primitive layer.
 *
 * Rules for anything that lives in this folder:
 *
 *  1. **No product knowledge.** A primitive must not know what a "subject line"
 *     or a "placing" is. The moment it does, it stops being reusable and starts
 *     being a feature component in the wrong folder.
 *  2. **Accessibility is not a prop.** 44px targets, focus rings and label
 *     wiring are guarantees, not options a caller can forget.
 *  3. **Tokens only.** No raw hex, no magic pixel values outside the
 *     component's own `--btn-*`-style knobs.
 *
 * Feature components live in `components/subjectrank/` and compose these.
 */
export { Button } from './Button';
export type { ButtonProps, ButtonTone, ButtonSize } from './Button';

export { Field, FieldGroup, useField } from './Field';
export type { FieldProps } from './Field';

export { TextInput } from './TextInput';
export type { TextInputProps } from './TextInput';

export { ChoiceList, ChipGroup } from './Choice';
export type { ChoiceOption, ChoiceListProps, ChipGroupProps } from './Choice';

export { Alert } from './Alert';
export type { AlertProps, AlertTone } from './Alert';

export { Badge } from './Badge';
export type { BadgeTone } from './Badge';

export { Card } from './Card';
export type { CardProps } from './Card';

export { Skeleton, SkeletonLineBlock } from './Skeleton';
export type { SkeletonProps } from './Skeleton';

export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';

export { VisuallyHidden } from './VisuallyHidden';
