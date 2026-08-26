"""Canonical Python implementation of the SubjectRank feature specification.

This module implements docs/FEATURES.md. It is NOT the reference -- that document
is. web/src/lib/features.ts implements the same spec and the parity suite asserts
the two agree element-wise.

Deliberate constraint (D-004): extract() takes a single string and nothing else.
It cannot see a dataframe, a row, or a dataset column, which makes the leakage ban
structural rather than aspirational.
"""
from __future__ import annotations

import json
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Sequence

SHARED = Path(__file__).resolve().parents[2] / "shared"

# --- 1. Normalisation ------------------------------------------------------

# docs/FEATURES.md 1.2. Written out rather than using \s: Python's \s and
# JavaScript's \s do not agree on Unicode, and that disagreement would be a
# silent parity failure rather than a loud one.
WS = frozenset(
    [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0x85, 0xA0, 0x1680]
    + list(range(0x2000, 0x200B))
    + [0x2028, 0x2029, 0x202F, 0x205F, 0x3000]
)
ZERO_WIDTH = frozenset([0x200B, 0x200C, 0x200D, 0xFEFF])
APOSTROPHES = frozenset("'’")

FEATURE_SPEC_VERSION = 1


@lru_cache(maxsize=1)
def _resources() -> Dict:
    def load(p: str) -> Dict:
        return json.loads((SHARED / p).read_text(encoding="utf-8"))

    names = load("feature_names.json")
    pron = load("lexicons/pronouns.json")
    cur = load("lexicons/curiosity.json")
    ft = load("lexicons/first_token.json")
    pol = load("lexicons/polarity.json")
    emo = load("lexicons/emoji_ranges.json")
    ovr = load("lexicons/category_overrides.json")

    if names["spec_version"] != FEATURE_SPEC_VERSION:
        raise RuntimeError(
            f"feature_names.json is spec v{names['spec_version']} but this module "
            f"is v{FEATURE_SPEC_VERSION}. Refusing to run rather than emit a "
            f"vector whose meaning is ambiguous."
        )

    return {
        "names": names["names"],
        "second": frozenset(pron["second"]),
        "first_sing": frozenset(pron["first_sing"]),
        "first_plur": frozenset(pron["first_plur"]),
        "third": frozenset(pron["third"]),
        "demonstratives": frozenset(cur["demonstratives"]),
        "wh_words": frozenset(cur["wh_words"]),
        "intensifiers": frozenset(cur["intensifiers"]),
        "superlatives": frozenset(cur["superlatives"]),
        "ft": {k: frozenset(v) for k, v in ft.items()},
        "polarity": pol["scores"],
        "negators": frozenset(pol["negators"]),
        "neg_window": int(pol["negation_window"]),
        "emoji_ranges": [tuple(r) for r in emo["ranges"]],
        "emoji_mods": frozenset(emo["modifier_code_points"]),
        "ri": tuple(emo["regional_indicator"]),
        "overrides": {int(k): v for k, v in ovr["overrides"].items()},
    }


def feature_names() -> List[str]:
    return list(_resources()["names"])


def _category(ch: str) -> str:
    """General category, with the override table taking precedence.

    The override table exists because CPython and Node derive their category data
    from different Unicode Character Database versions. Pinning contested code
    points to a file makes behaviour a property of the repository rather than of
    whichever runtime happens to be installed. See docs/FEATURES.md 2.2.
    """
    ov = _resources()["overrides"]
    cp = ord(ch)
    if cp in ov:
        return ov[cp]
    return unicodedata.category(ch)


def normalise(raw: str) -> str:
    """NFC -> collapse whitespace runs to U+0020 -> trim. docs/FEATURES.md 1."""
    nfc = unicodedata.normalize("NFC", raw)
    out: List[str] = []
    in_ws = False
    for ch in nfc:
        if ord(ch) in WS:
            if not in_ws:
                out.append(" ")
            in_ws = True
        else:
            out.append(ch)
            in_ws = False
    return "".join(out).strip(" ")


# --- 2. Tokenisation -------------------------------------------------------

def _is_letter(ch: str) -> bool:
    return _category(ch).startswith("L")


def _is_nd(ch: str) -> bool:
    return _category(ch) == "Nd"


def tokenise(text: str) -> List[str]:
    """Maximal runs of letter / Nd digit / apostrophe. docs/FEATURES.md 2.1."""
    tokens: List[str] = []
    cur: List[str] = []
    for ch in text:
        if _is_letter(ch) or _is_nd(ch) or ch in APOSTROPHES:
            cur.append(ch)
        else:
            if cur:
                tokens.append("".join(cur))
                cur = []
    if cur:
        tokens.append("".join(cur))

    cleaned: List[str] = []
    for t in tokens:
        t = t.strip("'’")
        if t:
            cleaned.append(t)
    return cleaned


def fold(token: str) -> str:
    return token.lower().replace("’", "'")


# --- 3. Emoji --------------------------------------------------------------

def _is_emoji_char(ch: str) -> bool:
    cp = ord(ch)
    lo, hi = _resources()["ri"]
    if lo <= cp <= hi:
        return True
    for a, b in _resources()["emoji_ranges"]:
        if a <= cp <= b:
            return True
    return False


def _is_cluster_member(ch: str) -> bool:
    return _is_emoji_char(ch) or ord(ch) in _resources()["emoji_mods"]


def _is_ri(ch: str) -> bool:
    lo, hi = _resources()["ri"]
    return lo <= ord(ch) <= hi


def _emoji_clusters(text: str) -> List[tuple]:
    """(start, end) index pairs of emoji clusters. docs/FEATURES.md 3.6.

    Deliberately not "maximal run of emoji characters": that merges two adjacent
    but distinct emoji into one cluster, so a subject line ending in two separate
    emoji would report emoji_count == 1. Instead each cluster is one base plus its
    modifiers and ZWJ continuations.
    """
    R = _resources()
    mods = R["emoji_mods"]
    chars = list(text)
    n = len(chars)
    spans: List[tuple] = []
    i = 0
    while i < n:
        if not _is_emoji_char(chars[i]):
            i += 1
            continue
        start = i
        if _is_ri(chars[i]) and i + 1 < n and _is_ri(chars[i + 1]):
            i += 2                      # regional indicator pair == one flag
        else:
            i += 1
            while i < n:
                if ord(chars[i]) in mods and chars[i] != "\u200d":
                    i += 1
                    continue
                if (chars[i] == "\u200d" and i + 1 < n
                        and _is_emoji_char(chars[i + 1])):
                    i += 2
                    continue
                break
        spans.append((start, i))
    return spans


# --- 4. Syllables ----------------------------------------------------------

ASCII_LOWER = frozenset("abcdefghijklmnopqrstuvwxyz")
VOWELS = frozenset("aeiouy")


def syllables(token_lower: str) -> int:
    """docs/FEATURES.md 3.8. Crude, and identical in both languages, which is the
    property that actually matters here."""
    letters = [c for c in token_lower if c in ASCII_LOWER]
    if not letters:
        return 1
    count = 0
    prev_vowel = False
    for c in letters:
        v = c in VOWELS
        if v and not prev_vowel:
            count += 1
        prev_vowel = v
    w = "".join(letters)
    if w.endswith("e") and not w.endswith("le") and count > 1:
        count -= 1
    return max(count, 1)


# --- 5. Extraction ---------------------------------------------------------

def _digit_value(ch: str) -> int:
    try:
        return unicodedata.digit(ch)
    except (TypeError, ValueError):
        return 0


def extract(raw: str) -> List[float]:
    """Extract the fixed-order feature vector for one string."""
    R = _resources()
    text = normalise(raw)
    tokens = tokenise(text)
    lower = [fold(t) for t in tokens]
    L = len(tokens)

    chars = [c for c in text if ord(c) not in ZERO_WIDTH]
    C = len(chars)

    f: Dict[str, float] = {}

    # 3.1 length and shape
    syl = [syllables(t) for t in lower]
    f["char_count"] = float(C)
    f["word_count"] = float(L)
    f["mean_word_len"] = (sum(len(t) for t in tokens) / L) if L else 0.0
    f["max_word_len"] = float(max((len(t) for t in tokens), default=0))
    f["long_word_ratio"] = (sum(1 for s in syl if s >= 3) / L) if L else 0.0

    # 3.2 case
    cats = [_category(c) for c in chars]
    n_upper = sum(1 for c in cats if c == "Lu")
    n_cased = sum(1 for c in cats if c in ("Lu", "Ll"))
    f["upper_char_ratio"] = (n_upper / n_cased) if n_cased else 0.0

    allcaps = 0
    for t in tokens:
        cased = [c for c in t if _category(c) in ("Lu", "Ll")]
        if len(cased) >= 2 and all(_category(c) == "Lu" for c in cased):
            allcaps += 1
    f["allcaps_word_count"] = float(allcaps)
    f["title_case_ratio"] = (
        sum(1 for t in tokens if t and _category(t[0]) == "Lu") / L
    ) if L else 0.0

    # 3.3 digits
    n_digits = sum(1 for c in cats if c == "Nd")
    f["has_digit"] = 1.0 if n_digits else 0.0
    f["digit_count"] = float(n_digits)
    first_all_digit = bool(tokens) and all(_is_nd(c) for c in tokens[0])
    f["starts_with_digit"] = 1.0 if first_all_digit else 0.0
    if first_all_digit:
        val = 0
        for c in tokens[0]:
            val = val * 10 + _digit_value(c)
            if val > 1000:
                break
        f["leading_number_magnitude"] = float(min(val, 1000))
    else:
        f["leading_number_magnitude"] = 0.0

    # 3.4 punctuation
    f["has_question"] = 1.0 if ("?" in text or "？" in text) else 0.0
    n_excl = text.count("!") + text.count("！")
    f["has_exclamation"] = 1.0 if n_excl else 0.0
    f["exclamation_count"] = float(n_excl)
    f["has_ellipsis"] = 1.0 if ("…" in text or "..." in text) else 0.0
    f["comma_count"] = float(text.count(",") + text.count("，"))
    f["has_colon"] = 1.0 if ":" in text else 0.0
    f["has_quote"] = 1.0 if any(c in text for c in '"\'‘’“”') else 0.0
    f["has_dash"] = 1.0 if any(c in text for c in "-–—") else 0.0

    # Terminal punctuation, scanning right-to-left past trailing emoji and
    # zero-width characters so "Really?? \U0001F389" still ends in a question mark.
    tail = list(text)
    while tail and (_is_cluster_member(tail[-1]) or ord(tail[-1]) in ZERO_WIDTH or tail[-1] == " "):
        tail.pop()
    last = tail[-1] if tail else ""
    f["ends_question"] = 1.0 if last in ("?", "？") else 0.0
    f["ends_exclamation"] = 1.0 if last in ("!", "！") else 0.0
    trimmed = "".join(tail)
    f["ends_ellipsis"] = 1.0 if (trimmed.endswith("…") or trimmed.endswith("...")) else 0.0

    # 3.5 lexicon counts
    f["second_person_count"] = float(sum(1 for t in lower if t in R["second"]))
    f["first_person_sing_count"] = float(sum(1 for t in lower if t in R["first_sing"]))
    f["first_person_plur_count"] = float(sum(1 for t in lower if t in R["first_plur"]))
    f["third_person_count"] = float(sum(1 for t in lower if t in R["third"]))
    f["demonstrative_count"] = float(sum(1 for t in lower if t in R["demonstratives"]))
    f["wh_word_count"] = float(sum(1 for t in lower if t in R["wh_words"]))
    f["intensifier_count"] = float(sum(1 for t in lower if t in R["intensifiers"]))
    f["superlative_count"] = float(sum(1 for t in lower if t in R["superlatives"]))
    f["leading_demonstrative"] = 1.0 if any(
        t in R["demonstratives"] for t in lower[:3]
    ) else 0.0

    # 3.6 emoji
    spans = _emoji_clusters(text)
    f["has_emoji"] = 1.0 if spans else 0.0
    f["emoji_count"] = float(len(spans))
    f["emoji_leading"] = 1.0 if (spans and spans[0][0] == 0) else 0.0
    f["emoji_trailing"] = 1.0 if (spans and spans[-1][1] == len(text)) else 0.0

    # 3.7 polarity
    pol_sum = pol_abs = 0.0
    pos_n = neg_n = 0
    W = R["neg_window"]
    for i, t in enumerate(lower):
        score = R["polarity"].get(t)
        if score is None:
            continue
        window = lower[max(0, i - W):i]
        if any(w in R["negators"] for w in window):
            score = -score
        pol_sum += score
        pol_abs += abs(score)
        if score > 0:
            pos_n += 1
        elif score < 0:
            neg_n += 1
    f["polarity_sum"] = pol_sum
    f["polarity_abs_sum"] = pol_abs
    f["polarity_pos_count"] = float(pos_n)
    f["polarity_neg_count"] = float(neg_n)

    # 3.8 readability
    total_syl = sum(syl)
    f["syllable_count"] = float(total_syl)
    f["mean_syllables_per_word"] = (total_syl / L) if L else 0.0
    if L:
        sentences = 0
        prev_term = False
        for c in text:
            term = c in ".!?"
            if term and not prev_term:
                sentences += 1
            prev_term = term
        sentences = max(1, sentences)
        flesch = 206.835 - 1.015 * (L / sentences) - 84.6 * (total_syl / L)
        f["flesch_reading_ease"] = max(-100.0, min(150.0, flesch))
    else:
        f["flesch_reading_ease"] = 0.0

    # 3.9 first-token class
    for k in ("determiner", "wh", "pronoun", "preposition", "auxiliary",
              "numeral", "verb_common", "other"):
        f["ft_" + k] = 0.0
    if L:
        t0 = lower[0]
        if first_all_digit:
            cls = "numeral"
        elif t0 in R["ft"]["wh"]:
            cls = "wh"
        elif t0 in R["ft"]["determiner"]:
            cls = "determiner"
        elif t0 in R["ft"]["pronoun"]:
            cls = "pronoun"
        elif t0 in R["ft"]["auxiliary"]:
            cls = "auxiliary"
        elif t0 in R["ft"]["preposition"]:
            cls = "preposition"
        elif t0 in R["ft"]["verb_common"]:
            cls = "verb_common"
        else:
            cls = "other"
        f["ft_" + cls] = 1.0

    # 3.10 script
    f["non_ascii_ratio"] = (sum(1 for c in chars if ord(c) > 127) / C) if C else 0.0

    vec = [float(f[n]) for n in R["names"]]
    for i, v in enumerate(vec):
        if v != v or v in (float("inf"), float("-inf")):
            raise ValueError(f"non-finite feature {R['names'][i]!r} for input {raw!r}")
    return vec


def extract_many(texts: Sequence[str]):
    import numpy as np
    return np.asarray([extract(t) for t in texts], dtype=np.float64)
