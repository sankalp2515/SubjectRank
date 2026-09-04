"""Apply the two fixes that live in files on the device, not in the container.

Both come out of the adversarial review of the app source:

  1. The parity corpus contains no non-ASCII digit with the value 9, so it could
     not catch the DIGIT_VALUE off-by-one in the TypeScript extractor (٩ and ९
     both extracted as 0 while Python returned 9). Fixing the code without fixing
     the corpus leaves the blind spot in place.
  2. MORNING.md's environment table is missing SESSION_SECRET and ADMIN_TOKEN.
     Deploying without either is a real failure: no session secret means the app
     refuses to start in production, and no admin token means /admin is closed
     (which is the safe direction, but Sankalp needs to know why).

Run from the repo root:  python apply_device_fixes.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
changed = []

# --- 1. parity corpus ------------------------------------------------------
gen = ROOT / "ml" / "scripts" / "build_parity_corpus.py"
if gen.exists():
    s = gen.read_text(encoding="utf-8")
    anchor = 'add("１２３ items", "fullwidth digits (Nd)")'
    addition = anchor + '''
# Value-9 digits specifically. Their absence let a real bug through: the TS
# DIGIT_VALUE loop stopped one code point short of the block boundary, so any
# non-ASCII digit with value 9 resolved to 0 while Python returned 9. Every
# non-ASCII digit case in the corpus happened to be 1, 2 or 3.
add("٩ طرق لتوفير المال", "Arabic-Indic NINE - the off-by-one case")
add("٩", "Arabic-Indic nine alone")
add("९ तरीके", "Devanagari NINE")
add("９ ways", "fullwidth NINE")
add("١٩ things", "Arabic-Indic nineteen - two-digit, ends in 9")
add("٠٩ leading zero", "Arabic-Indic zero-nine")'''
    if anchor in s and "off-by-one case" not in s:
        gen.write_text(s.replace(anchor, addition, 1), encoding="utf-8")
        changed.append("ml/scripts/build_parity_corpus.py (+6 value-9 digit cases)")
    else:
        print("  corpus generator: anchor missing or already patched", file=sys.stderr)

# --- 2. MORNING.md env table ----------------------------------------------
m = ROOT / "MORNING.md"
if m.exists():
    s = m.read_text(encoding="utf-8")
    anchor = "   | `CRON_SECRET` | generate a random string | server only |"
    addition = anchor + """
   | `SESSION_SECRET` | generate a random string | server only |
   | `ADMIN_TOKEN` | generate a random string | server only |

   `SESSION_SECRET` signs the session cookie. **The app refuses to start in
   production without it** — unsigned session cookies would let anyone forge
   another visitor's identity, so failing loudly beats starting insecurely.

   `ADMIN_TOKEN` gates `/admin`. Without it that route returns 404 to everyone,
   including you. To get in, set the cookie once in the browser console on the
   deployed origin:
   ```js
   document.cookie = 'sr_admin=<the token>; path=/; secure; samesite=lax'
   ```"""
    if anchor in s and "SESSION_SECRET" not in s:
        m.write_text(s.replace(anchor, addition, 1), encoding="utf-8")
        changed.append("MORNING.md (SESSION_SECRET + ADMIN_TOKEN)")
    else:
        print("  MORNING.md: anchor missing or already patched", file=sys.stderr)

if changed:
    print("applied:")
    for c in changed:
        print("  -", c)
    print("\nNow re-run:")
    print("  python ml/scripts/build_parity_corpus.py")
    print("  python ml/scripts/build_parity_expected.py")
    print("  cd web && npx tsx ../parity/run_parity.ts")
    print("  python parity/mutation_check.py")
else:
    print("nothing to apply")
