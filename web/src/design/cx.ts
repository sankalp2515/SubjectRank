/**
 * Class composition and typed variants. ~40 lines, zero dependencies.
 *
 * Why not `clsx` + `cva` + `tailwind-merge`? Because this app has six runtime
 * dependencies and a 523 MB container image, and the whole of what those three
 * packages do for us fits below with full type inference. A dependency is a
 * liability you rent; this one is not worth renting.
 *
 * Why not Tailwind? Considered seriously and rejected. The product has one
 * genuinely unusual styling need — marks drawn *on* the user's own text at exact
 * character offsets, plus a hatched "no opinion" state — and those are CSS
 * problems, not utility-class problems. CSS Modules give scoping, dead-code
 * elimination and real cascade control with no build change on top of Next.
 */

export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | { [key: string]: boolean | null | undefined };

/** Join class values, dropping anything falsy. */
export function cx(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input));
    } else if (Array.isArray(input)) {
      const nested = cx(...input);
      if (nested) out.push(nested);
    } else if (typeof input === 'object') {
      for (const key in input) if (input[key]) out.push(key);
    }
  }
  return out.join(' ');
}

type VariantShape = Record<string, Record<string, string>>;

/** Infer the props a variant config accepts, so a typo is a type error. */
export type VariantProps<V extends VariantShape> = {
  [K in keyof V]?: keyof V[K];
};

/**
 * Build a class-name function from a base class and a variant map.
 *
 * The `defaults` are applied when a prop is undefined, so a component always
 * renders a defined variant rather than an unstyled element — the failure mode
 * where a missing prop silently produces a naked <button> is a real one.
 *
 * @example
 *   const button = variants(s.button, {
 *     tone: { primary: s.primary, ghost: s.ghost },
 *     size: { sm: s.sm, md: s.md },
 *   }, { tone: 'primary', size: 'md' });
 *
 *   button({ tone: 'ghost' })       // "button ghost md"
 */
export function variants<V extends VariantShape>(
  base: string,
  config: V,
  defaults: VariantProps<V> = {},
) {
  return (props: VariantProps<V> & { className?: ClassValue } = {}): string => {
    const picked: string[] = [];
    for (const key in config) {
      const chosen = (props[key] ?? defaults[key]) as string | undefined;
      if (chosen !== undefined && config[key][chosen]) picked.push(config[key][chosen]);
    }
    return cx(base, picked, props.className);
  };
}

/**
 * Stable ids for label/control wiring.
 *
 * `useId` is the correct React 18+ answer and this is a thin wrapper so that
 * every Field derives its `-hint` and `-error` ids the same way. Hand-rolled
 * ids drift, and a mismatched `aria-describedby` fails silently — the field
 * looks fine and a screen reader simply never announces the error.
 */
export const describedBy = (...ids: (string | false | undefined)[]) =>
  ids.filter(Boolean).join(' ') || undefined;
