"""Verify the parity suite can actually FAIL.

A parity suite that passes on the first run is not evidence of parity -- it is
equally consistent with a suite that compares nothing. This script injects known
bugs into web/src/lib/features.ts one at a time and asserts the suite catches each
one, then restores the file.

Each mutation is a real mistake someone could plausibly make, not a random
character swap. If any mutation survives, the suite has a blind spot and the
corpus needs a case for it.
"""
import pathlib
import shutil
import os
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / "web" / "src" / "lib" / "features.ts"
WEB = ROOT / "web"

MUTATIONS = [
    (
        "UTF-16 length instead of code points",
        "f.char_count = C;",
        "f.char_count = text.length;",
        "the .length-vs-Array.from trap called out in FEATURES.md 3.1",
    ),
    (
        "emoji clusters as maximal runs",
        "if (isRI(chars[i]) && i + 1 < n && isRI(chars[i + 1])) {",
        "if (true) {",
        "merges adjacent distinct emoji into one cluster",
    ),
    (
        "negation window off by one",
        "lower.slice(Math.max(0, i - NEGATION_WINDOW), i)",
        "lower.slice(Math.max(0, i - NEGATION_WINDOW + 1), i)",
        "silently changes which polarity words get flipped",
    ),
    (
        "whitespace collapse skipped",
        "if (WS.has(ch.codePointAt(0)!)) {",
        "if (ch === ' ') {",
        "NBSP and friends stop being treated as whitespace",
    ),
    (
        "non-ASCII digit value off-by-one",
        "for (let base = cp; base >= cp - 10; base--) {",
        "for (let base = cp; base > cp - 10; base--) {",
        "every non-ASCII digit with value 9 resolves to 0 - this one SHIPPED, "
        "because no corpus entry had a non-ASCII 9 in it",
    ),
    (
        "digit class widened from Nd to N",
        "const RE_ND = /\\p{Nd}/u;",
        "const RE_ND = /\\p{N}/u;",
        "superscripts and fractions start counting as digits",
    ),
    (
        "flesch clamp removed",
        "f.flesch_reading_ease = Math.max(-100, Math.min(150, flesch));",
        "f.flesch_reading_ease = flesch;",
        "outliers reappear on pathological tokens",
    ),
    (
        "leading demonstrative window widened",
        "lower.slice(0, 3).some((t) => DEMONSTRATIVES.has(t))",
        "lower.some((t) => DEMONSTRATIVES.has(t))",
        "destroys the position sensitivity the feature exists for",
    ),
    (
        "title case counts any letter",
        "category(Array.from(t)[0]) === 'Lu'",
        "category(Array.from(t)[0]).startsWith('L')",
        "every token becomes title case",
    ),
]


def run_parity() -> int:
    # npm writes a `.cmd` shim on Windows and an extensionless shell script
    # everywhere else, so the bare path only exists on one of the two. This gate
    # is listed as required before every deploy; a runner that cannot start on
    # the machine doing the deploying is a gate that silently never runs.
    exe = WEB / "node_modules" / ".bin" / ("tsx.cmd" if os.name == "nt" else "tsx")
    if not exe.exists():
        print(f"  cannot find {exe} -- run `npm install` in web/ first", file=sys.stderr)
        return 1
    return subprocess.run(
        [str(exe), "../parity/run_parity.ts"],
        cwd=WEB, capture_output=True, text=True,
    ).returncode


def main() -> int:
    original = TARGET.read_text(encoding="utf-8")
    backup = pathlib.Path(tempfile.mkdtemp()) / "features.ts.bak"
    backup.write_text(original, encoding="utf-8")

    print("baseline: unmutated source must PASS")
    if run_parity() != 0:
        print("  baseline already fails -- fix that before running mutations", file=sys.stderr)
        return 1
    print("  ok\n")

    survived = []
    try:
        for name, find, replace, why in MUTATIONS:
            if find not in original:
                print(f"  \033[33mSKIP\033[0m  {name}: anchor not found "
                      f"(features.ts changed -- update this script)")
                survived.append((name, "anchor missing"))
                continue
            TARGET.write_text(original.replace(find, replace, 1), encoding="utf-8")
            rc = run_parity()
            if rc == 0:
                print(f"  \033[31mSURVIVED\033[0m  {name}")
                print(f"            {why}")
                survived.append((name, why))
            else:
                print(f"  \033[32mcaught\033[0m    {name}")
    finally:
        TARGET.write_text(original, encoding="utf-8")
        assert TARGET.read_text(encoding="utf-8") == original

    print()
    if survived:
        print(f"\033[31m{len(survived)}/{len(MUTATIONS)} mutations SURVIVED\033[0m")
        print("The parity corpus has a blind spot. Add cases to "
              "ml/scripts/build_parity_corpus.py until every mutation is caught.")
        return 1
    print(f"\033[32mall {len(MUTATIONS)} mutations caught\033[0m -- "
          f"the parity suite has teeth")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
