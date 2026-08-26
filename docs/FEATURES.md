# Feature specification v1

**This document is the contract.** `ml/subjectrank/features.py` (training) and
`web/src/lib/features.ts` (serving) are two implementations of it. Neither is the
reference; *this file* is. When they disagree, the parity suite fails and the
question is which one violated the spec — not which one is "right".

Every rule here is stated so that two people who have never spoken could implement
it identically. Where a rule looks pedantic, it is because the alternative is a
silent divergence discovered in production six months later.

Rationale for the overall approach is D-006 in `DECISIONS.md`.

---

## 0. Non-negotiables

- The extractor takes **one string and nothing else**. It never sees a dataframe, a
  row, a column, or any dataset metadata. This is what makes the leakage ban in D-004
  structural rather than aspirational.
- Output is a **fixed-length, fixed-order** vector of `float64`. Order is defined by
  `FEATURE_NAMES` in §7 and must never be reordered — the ONNX graph is positional.
- Every feature is **finite**. No `NaN`, no `Infinity`. Divisions guard their
  denominator and return `0.0` when it would be zero. This is checked by assertion in
  both implementations.
- No feature may depend on the *other* line in a comparison. Features are per-string;
  the pairing happens afterwards by subtraction.

---

## 1. Normalisation pipeline

Applied in this exact order.

**1.1 Unicode normalisation.** `nfc = NFC(input)`.
Python `unicodedata.normalize("NFC", s)` · TS `s.normalize("NFC")`.

Rationale: `é` can arrive as one code point or two. Without this, character counts
differ by the user's keyboard.

**1.2 Whitespace class.** WS is exactly this set, written out rather than relying on
`\s`, because Python's `\s` and JavaScript's `\s` do not agree on Unicode:

```
U+0009 U+000A U+000B U+000C U+000D U+0020 U+0085 U+00A0 U+1680
U+2000..U+200A U+2028 U+2029 U+202F U+205F U+3000
```

**1.3 Collapse.** Replace every maximal run of WS characters with a single U+0020.

**1.4 Trim.** Remove leading and trailing U+0020.

The result is `text`. **Every feature below is computed on `text`**, never on the
raw input. Consequence: `"  Hello   world  "` and `"Hello world"` produce identical
vectors, which is correct — a user's trailing space is not a headline property.

**1.5 Zero-width characters.** U+200B, U+200C, U+200D, U+FEFF are *not* whitespace and
are *not* stripped. U+200D in particular is the emoji ZWJ and removing it would break
family/profession emoji sequences into their components. They are, however, excluded
from `char_count` — see §3.1.

---

## 2. Tokenisation

**2.1 Token definition.** A token is a maximal run of characters where each character
is either a Unicode **letter** (general category `L*`), a Unicode **decimal digit**
(general category `Nd`, exactly — *not* `N*`), or one of the apostrophes
`U+0027 '` / `U+2019 ’`.

An apostrophe may not begin or end a token: strip leading and trailing apostrophes
after the run is extracted, and drop the token if nothing remains.

Rationale for `Nd` exactly: Python's `str.isdigit()` returns true for superscript ²
and other `No` characters; JavaScript's `\p{Nd}` does not. Pinning to `Nd` makes them
agree. Rationale for keeping apostrophes internal: `don't` and `you're` must be one
token for the pronoun and negation lexicons to fire.

**2.2 Category lookup.** Python uses `unicodedata.category(ch)`; TypeScript uses
regex property escapes `\p{L}` and `\p{Nd}` with the `u` flag.

**Known risk:** these derive from different Unicode Character Database versions
(CPython 3.10 → UCD 14.0; Node 22 → UCD 15.1). Characters added between versions can
be classified differently. This is not hypothetical and it is exactly what the parity
suite exists to catch. Any divergence found is resolved by adding the code point to
`shared/lexicons/category_overrides.json`, which **both** implementations consult
before falling back to their runtime — pinning behaviour to the file rather than to
whichever runtime happens to be installed.

**2.3 Folding.** `tokens_lower[i] = lowercase(tokens[i])` using simple lowercase
(Python `str.lower()`, TS `String.prototype.toLowerCase()`), then replace `U+2019`
with `U+0027` so `don’t` and `don't` are the same lexicon key.

Note: Python and JS lowercase differ for a handful of code points, notably the Turkish
dotted capital İ (U+0130), which Python maps to two code points and JS maps to two as
well but historically differed in older engines. Covered by the parity corpus.

**2.4 Lexicon matching** is always against `tokens_lower`, never against raw text, and
always as a whole-token equality check — never substring. `"assess"` must not match
the negator `"ass"`; whole-token matching makes that structurally impossible.

---

## 3. Feature definitions

`L` = number of tokens. `chars` = code point array of `text` excluding the zero-width
set from §1.5. `C` = `len(chars)`.

Guard convention: every ratio returns `0.0` when its denominator is 0.

### 3.1 Length and shape

| Name | Definition |
|---|---|
| `char_count` | `C` |
| `word_count` | `L` |
| `mean_word_len` | mean code-point length of tokens, `0.0` if `L=0` |
| `max_word_len` | longest token in code points, `0.0` if `L=0` |
| `long_word_ratio` | tokens with ≥3 syllables (§4) ÷ `L` |

`char_count` counts **code points**, not UTF-16 units and not grapheme clusters.
Python `len(s)` is already code points; TypeScript **must** use `Array.from(s).length`
— `s.length` returns UTF-16 units and would count an emoji as 2. This single line is
the most likely place for the two implementations to silently disagree.

### 3.2 Case

| Name | Definition |
|---|---|
| `upper_char_ratio` | uppercase letters ÷ total letters in `chars` |
| `allcaps_word_count` | tokens with ≥2 cased letters where every cased letter is uppercase |
| `title_case_ratio` | tokens whose first character is an uppercase letter ÷ `L` |

"Uppercase letter" = general category `Lu`. "Cased letter" = `Lu` or `Ll`. Scripts
without case (Arabic, Devanagari, CJK) contribute 0 to both numerator and denominator,
so `upper_char_ratio` is `0.0` for a wholly non-cased string rather than undefined.

### 3.3 Digits

| Name | Definition |
|---|---|
| `has_digit` | 1.0 if any `Nd` character in `text` |
| `digit_count` | count of `Nd` characters |
| `starts_with_digit` | 1.0 if `tokens[0]` consists only of `Nd` characters |
| `leading_number_magnitude` | see below |

`leading_number_magnitude`: if `tokens[0]` is all-`Nd`, parse its **ASCII digit value**
(`Nd` characters outside ASCII are mapped to their numeric value 0–9 via
`unicodedata.digit` / an explicit table in TS), then `min(value, 1000.0)`. Otherwise
`0.0`. The cap prevents a year like `2015` from dominating the split.

### 3.4 Punctuation

Computed on `text` directly, not on tokens.

| Name | Definition |
|---|---|
| `has_question` | 1.0 if `?` or `U+FF1F` present |
| `has_exclamation` | 1.0 if `!` or `U+FF01` present |
| `exclamation_count` | count of those |
| `has_ellipsis` | 1.0 if `U+2026` present, or three or more consecutive `.` |
| `comma_count` | count of `,` and `U+FF0C` |
| `has_colon` | 1.0 if `:` present |
| `has_quote` | 1.0 if any of `" ' U+2018 U+2019 U+201C U+201D` present |
| `has_dash` | 1.0 if any of `- U+2013 U+2014` present |
| `ends_question` | 1.0 if last non-WS char is `?`/`U+FF1F` |
| `ends_exclamation` | 1.0 if last non-WS char is `!`/`U+FF01` |
| `ends_ellipsis` | 1.0 if `text` ends with `U+2026` or with `...` |

`ends_*` are evaluated **after** trailing emoji and zero-width characters are ignored,
so `"Really?? 🎉"` still counts as ending in a question mark. Trailing characters are
scanned right-to-left, skipping emoji (§3.6) and the zero-width set, until the first
other character is found.

### 3.5 Lexicon counts

All from `shared/lexicons/*.json`, matched as whole lowercase tokens (§2.4). Both
implementations load the same files — there is exactly one copy of every word list in
the repository. This is deliberate and is the main reason the parity suite has a
chance of passing.

| Name | Lexicon file | Notes |
|---|---|---|
| `second_person_count` | `pronouns.json` → `second` | you, your, yours, yourself, you're… |
| `first_person_sing_count` | `pronouns.json` → `first_sing` | i, me, my, mine, i'm… |
| `first_person_plur_count` | `pronouns.json` → `first_plur` | we, us, our, ours… |
| `third_person_count` | `pronouns.json` → `third` | he, she, they, them… |
| `demonstrative_count` | `curiosity.json` → `demonstratives` | this, that, these, those |
| `wh_word_count` | `curiosity.json` → `wh_words` | what, why, how, when, where, who, which |
| `intensifier_count` | `curiosity.json` → `intensifiers` | very, really, literally, actually… |
| `superlative_count` | `curiosity.json` → `superlatives` | best, worst, most, greatest… |
| `leading_demonstrative` | — | 1.0 if any of `tokens_lower[0:3]` is a demonstrative |

`leading_demonstrative` is the curiosity-gap marker: "This is what happened when…"
opens with a demonstrative that has no referent yet. A demonstrative late in the line
usually *does* have a referent, so position matters and a bare count would blur it.

### 3.6 Emoji

An emoji character is one whose code point falls in the ranges listed in
`shared/lexicons/emoji_ranges.json`. Ranges are the single source of truth; neither
implementation hardcodes them, and TypeScript specifically must **not** use
`\p{Emoji}` — it matches ASCII digits and `#`, which would be a silent disaster.

An **emoji cluster** is built by this algorithm, not by "maximal run" -- a maximal
run would merge two adjacent but distinct emoji into one, which is wrong:

```
at an emoji character:
    consume it as the cluster base
    loop:
        consume any following variation selector (U+FE0E/U+FE0F),
            skin-tone modifier (U+1F3FB..U+1F3FF), or keycap (U+20E3)
        if the next character is U+200D and the one after it is an emoji:
            consume both and continue the loop      # ZWJ sequence
        else break
```

A pair of regional indicators (U+1F1E6..U+1F1FF) forms one cluster -- that is a flag.
An unpaired regional indicator is its own cluster.

Consequences, all three of which are asserted in the parity corpus:
`😱😱` is **2** clusters, `👨‍👩‍👧‍👦` is **1**, `🇺🇸` is **1**.

| Name | Definition |
|---|---|
| `has_emoji` | 1.0 if ≥1 emoji character |
| `emoji_count` | number of emoji **clusters**, not characters |
| `emoji_leading` | 1.0 if `text` begins with an emoji cluster |
| `emoji_trailing` | 1.0 if `text` ends with an emoji cluster |

Clusters, not characters, because 👨‍👩‍👧‍👦 is one emoji to a reader and four code
points plus three ZWJs to a naive counter.

> **Domain-gap warning, and it is load-bearing.** Emoji are near-absent from
> 2013–2015 Upworthy headlines. The pipeline measures the actual support for these
> four features in the training pairs and writes it to `EXPERIMENTS.md`. If support is
> below the threshold in `config.yaml`, the emoji features are **excluded from the
> model** and the UI must not attribute anything to emoji. A model that has never seen
> an emoji must not be allowed to render an opinion about one. See D-012.

### 3.7 Polarity

Lexicon `shared/lexicons/polarity.json`: a flat map from lowercase token to a score in
`[-1, 1]`. Not VADER — see D-007 for why.

**Negation rule.** A polarity token's sign is flipped if any token in the **three
tokens immediately preceding it** appears in `polarity.json → negators`. The window is
three, it does not cross the start of the string, and it does not reset at punctuation
(punctuation is not tokenised, so it is invisible here — an accepted simplification,
recorded as such).

| Name | Definition |
|---|---|
| `polarity_sum` | sum of signed scores |
| `polarity_abs_sum` | sum of absolute scores (intensity regardless of direction) |
| `polarity_pos_count` | tokens with post-negation score > 0 |
| `polarity_neg_count` | tokens with post-negation score < 0 |

### 3.8 Readability

**Syllable algorithm.** Specified exactly, because every library does this differently.

```
syllables(token_lower):
    letters = [c for c in token_lower if c in "abcdefghijklmnopqrstuvwxyz"]
    if letters is empty: return 1
    count = 0; prev_vowel = false
    for c in letters:
        v = c in "aeiouy"
        if v and not prev_vowel: count += 1
        prev_vowel = v
    if letters ends with "e" and not ends with "le" and count > 1: count -= 1
    return max(count, 1)
```

Non-ASCII letters are dropped before counting, so a wholly non-Latin token yields 1.
Crude, and identical in both languages, which is the property that matters here.

| Name | Definition |
|---|---|
| `syllable_count` | Σ syllables over tokens |
| `mean_syllables_per_word` | `syllable_count ÷ L` |
| `flesch_reading_ease` | see below |

```
sentences = max(1, number of maximal runs of [.!?] in text)
flesch = 206.835 − 1.015 × (L / sentences) − 84.6 × (syllable_count / L)
```
`0.0` if `L = 0`. Clamped to `[-100, 150]` — Flesch is unbounded below and a single
pathological token would otherwise produce an outlier that dominates tree splits.

### 3.9 First-token class

One-hot over the class of `tokens_lower[0]`, from `shared/lexicons/first_token.json`.
Not a POS tag — see D-008 for why a statistical tagger was rejected.

Exactly one of these is 1.0; all are 0.0 when `L = 0`:

`ft_determiner` · `ft_wh` · `ft_pronoun` · `ft_preposition` · `ft_auxiliary` ·
`ft_numeral` · `ft_verb_common` · `ft_other`

Resolution order, first match wins: numeral (all-`Nd`) → wh → determiner → pronoun →
auxiliary → preposition → verb_common → other.

### 3.10 Script

| Name | Definition |
|---|---|
| `non_ascii_ratio` | characters with code point > 127 ÷ `C` |

---

## 4. Invariants the implementations must both satisfy

Asserted in unit tests on both sides, not merely documented:

1. **Determinism** — same input always yields the same vector.
2. **Whitespace invariance** — `f(x) == f(collapse_and_trim(x))` for all `x`.
3. **NFC invariance** — `f(NFD(x)) == f(NFC(x))`.
4. **Finiteness** — no `NaN`/`Inf` for any input, including `""`, a single space, a
   single ZWJ, 10,000 identical characters, and a lone surrogate.
5. **Length agreement** — `char_count` equals the code-point count on every corpus
   entry. Guards the `Array.from` mistake in §3.1 specifically.
6. **Empty-safety** — `f("")` returns the all-zeros vector of correct length, and
   does not throw.

---

## 5. Versioning

`FEATURE_SPEC_VERSION = 1`, exported by both implementations and asserted equal by the
parity suite. It is stamped into every trained model's metadata and into every row of
`ranking_items`.

Any change to feature order, count, or semantics increments it. A model trained under
version *n* may not be served by an extractor at version *m ≠ n* — the server refuses
to start rather than serving silently-wrong numbers.

---

## 6. What is deliberately absent

- **TF-IDF / character n-grams.** Evaluated as a third model and expected to be
  rejected: reproducing a fitted vectoriser's tokenisation exactly in TypeScript is
  the skew factory this whole document exists to avoid. If it wins by a large margin
  the decision gets revisited *with the margin written down*; if it wins by a small
  one it is rejected and the rejection is documented with the number.
- **Word embeddings / transformer features.** Same reason, more so, plus a cold-start
  and bundle-size cost that a free serverless tool cannot carry.
- **Anything derived from the other line in the comparison.** Features are per-string
  by construction; interaction is the model's job.

---

## 7. Canonical feature order

`FEATURE_NAMES` is defined once, in `shared/feature_names.json`, and imported by both
implementations. Neither hardcodes the list. The parity suite asserts that both report
the same names in the same order, and that the length matches the ONNX graph's
expected input dimension.
