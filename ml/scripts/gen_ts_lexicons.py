"""Generate web/src/lib/generated/lexicons.ts from shared/lexicons/*.json.

The JSON files are the single source of truth (docs/FEATURES.md 3.5). This script
projects them into a TypeScript module so the serving path needs no runtime file
IO and no bundler tracing, while still having exactly one copy of every word list
in the repository.

The generated file is committed and CI re-runs this script and fails on any diff,
so the two can never drift. Never hand-edit the output.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SHARED = ROOT / "shared"
OUT = ROOT / "web" / "src" / "lib" / "generated" / "lexicons.ts"


def j(p):
    return json.loads((SHARED / p).read_text(encoding="utf-8"))


def ts(v, indent=0):
    return json.dumps(v, ensure_ascii=False, indent=2)


def main() -> int:
    names = j("feature_names.json")
    pron, cur = j("lexicons/pronouns.json"), j("lexicons/curiosity.json")
    ft, pol = j("lexicons/first_token.json"), j("lexicons/polarity.json")
    emo, ovr = j("lexicons/emoji_ranges.json"), j("lexicons/category_overrides.json")

    parts = [
        "// GENERATED FILE - DO NOT EDIT.",
        "// Source: shared/lexicons/*.json + shared/feature_names.json",
        "// Regenerate: python ml/scripts/gen_ts_lexicons.py",
        "// CI re-runs the generator and fails on any diff, so this cannot drift",
        "// from the Python side's view of the same lexicons.",
        "",
        f"export const FEATURE_SPEC_VERSION = {names['spec_version']};",
        f"export const FEATURE_NAMES: readonly string[] = {ts(names['names'])} as const;",
        "",
        f"export const PRONOUNS = {ts(pron)};",
        f"export const CURIOSITY = {ts(cur)};",
        f"export const FIRST_TOKEN = {ts(ft)};",
        f"export const POLARITY_SCORES: Record<string, number> = {ts(pol['scores'])};",
        f"export const NEGATORS: readonly string[] = {ts(pol['negators'])};",
        f"export const NEGATION_WINDOW = {pol['negation_window']};",
        f"export const EMOJI_RANGES: readonly (readonly [number, number])[] = {ts(emo['ranges'])} as const;",
        f"export const EMOJI_MODIFIERS: readonly number[] = {ts(emo['modifier_code_points'])};",
        f"export const REGIONAL_INDICATOR: readonly [number, number] = {ts(emo['regional_indicator'])} as const;",
        f"export const CATEGORY_OVERRIDES: Record<string, string> = {ts(ovr['overrides'])};",
        "",
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    new = "\n".join(parts)

    if "--check" in sys.argv:
        cur_txt = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if cur_txt != new:
            print("STALE: lexicons.ts does not match shared/lexicons/*.json.", file=sys.stderr)
            print("Run: python ml/scripts/gen_ts_lexicons.py", file=sys.stderr)
            return 1
        print("lexicons.ts is up to date")
        return 0

    OUT.write_text(new, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(new)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
