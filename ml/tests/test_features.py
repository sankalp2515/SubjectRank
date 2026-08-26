"""Invariants from docs/FEATURES.md 4, asserted rather than merely documented."""
import json
import math
import pathlib
import sys
import unicodedata

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from subjectrank.features import (  # noqa: E402
    extract, feature_names, normalise, tokenise, syllables, FEATURE_SPEC_VERSION,
)

NAMES = feature_names()
IDX = {n: i for i, n in enumerate(NAMES)}
CORPUS = [e["text"] for e in json.loads(
    (ROOT / "parity" / "corpus.json").read_text(encoding="utf-8"))["entries"]]


def f(text, name):
    return extract(text)[IDX[name]]


# --- invariant 1: determinism ---------------------------------------------
@pytest.mark.parametrize("text", CORPUS)
def test_deterministic(text):
    assert extract(text) == extract(text)


# --- invariant 2: whitespace invariance -----------------------------------
@pytest.mark.parametrize("text", CORPUS)
def test_whitespace_invariance(text):
    assert extract(text) == extract(normalise(text))
    assert extract(text) == extract("   " + text + "   ")


# --- invariant 3: NFC invariance ------------------------------------------
@pytest.mark.parametrize("text", CORPUS)
def test_nfc_invariance(text):
    assert extract(unicodedata.normalize("NFD", text)) == extract(
        unicodedata.normalize("NFC", text))


# --- invariant 4: finiteness ----------------------------------------------
@pytest.mark.parametrize("text", CORPUS + [
    "", " ", "‍", "﻿", "x" * 10000, "́", "?" * 100, "\U0001f600" * 50,
])
def test_finite(text):
    for n, v in zip(NAMES, extract(text)):
        assert isinstance(v, float), n
        assert math.isfinite(v), f"{n} not finite for {text!r}"


# --- invariant 5: length agreement ----------------------------------------
@pytest.mark.parametrize("text", CORPUS)
def test_char_count_is_code_points(text):
    zw = {0x200B, 0x200C, 0x200D, 0xFEFF}
    expected = len([c for c in normalise(text) if ord(c) not in zw])
    assert f(text, "char_count") == float(expected)


# --- invariant 6: empty safety --------------------------------------------
def test_empty_is_all_zeros():
    v = extract("")
    assert len(v) == len(NAMES)
    assert all(x == 0.0 for x in v)


def test_vector_length_matches_names():
    assert len(extract("anything at all")) == len(NAMES) == 52


def test_spec_version_matches_shared_file():
    shared = json.loads((ROOT / "shared" / "feature_names.json").read_text())
    assert shared["spec_version"] == FEATURE_SPEC_VERSION
    assert shared["names"] == NAMES


# --- leakage guard (D-004) -------------------------------------------------
def test_no_feature_is_named_after_a_banned_column():
    banned = {"impressions", "clicks", "winner", "first_place", "significance"}
    for n in NAMES:
        assert not any(b in n for b in banned), n


def test_extract_takes_only_a_string():
    import inspect
    sig = inspect.signature(extract)
    assert list(sig.parameters) == ["raw"]


# --- targeted feature behaviour -------------------------------------------
def test_emoji_clusters():
    assert f("\U0001f631\U0001f631", "emoji_count") == 2.0
    assert f("\U0001f468‍\U0001f469‍\U0001f467‍\U0001f466", "emoji_count") == 1.0
    assert f("\U0001f1fa\U0001f1f8", "emoji_count") == 1.0
    assert f("\U0001f1fa\U0001f1f8\U0001f1ec\U0001f1e7", "emoji_count") == 2.0
    assert f("\U0001f44b\U0001f3fd", "emoji_count") == 1.0
    assert f("© 2026 Acme", "has_emoji") == 0.0, "(c) must not count as emoji"


def test_terminal_punctuation_behind_emoji():
    assert f("Really?? \U0001f389", "ends_question") == 1.0
    assert f("Done!\U0001f44d", "ends_exclamation") == 1.0


def test_nd_only_digits():
    assert f("²³ superscript", "has_digit") == 0.0, "superscripts are No, not Nd"
    assert f("١٢٣ items", "has_digit") == 1.0, "Arabic-Indic are Nd"
    assert f("½ portion", "has_digit") == 0.0, "vulgar fraction is No"


def test_leading_number_magnitude_cap():
    assert f("9 reasons", "leading_number_magnitude") == 9.0
    assert f("2015 was odd", "leading_number_magnitude") == 1000.0
    assert f("Top 10", "leading_number_magnitude") == 0.0


def test_apostrophe_folding():
    """Curly and straight apostrophes must produce the same TOKENS.

    The full vectors are deliberately NOT expected to match: U+2019 is non-ASCII,
    so non_ascii_ratio legitimately differs. Asserting whole-vector equality here
    would be asserting a bug.
    """
    from subjectrank.features import fold
    assert [fold(t) for t in tokenise("don't stop")] == \
           [fold(t) for t in tokenise("don’t stop")]
    assert f("It's not good", "polarity_sum") == f("It’s not good", "polarity_sum")
    assert f("don't stop", "word_count") == f("don’t stop", "word_count")


def test_negation_window():
    assert f("This is not good", "polarity_sum") < 0
    assert f("This is good", "polarity_sum") > 0
    assert f("not at all really good", "polarity_sum") > 0, "negator outside window"


def test_substring_trap():
    assert f("assess the class", "polarity_neg_count") == 0.0


def test_first_token_class_is_one_hot():
    ft = [n for n in NAMES if n.startswith("ft_")]
    for text in ["The truth", "Why we quit", "7 lessons", "Bananas are strange"]:
        v = extract(text)
        assert sum(v[IDX[n]] for n in ft) == 1.0, text
    assert sum(extract("")[IDX[n]] for n in ft) == 0.0


def test_syllables():
    assert syllables("the") == 1
    assert syllables("apple") == 2
    assert syllables("little") == 2
    assert syllables("code") == 1
    assert syllables("rhythm") == 1
    # 13, not the dictionary's 14. The algorithm in docs/FEATURES.md 3.8 is
    # deliberately crude; what matters is that TypeScript returns 13 too.
    assert syllables("supercalifragilisticexpialidocious") == 13
    assert syllables("你好") == 1


def test_tokenise_keeps_internal_apostrophe():
    assert tokenise("don't stop") == ["don't", "stop"]
    assert tokenise("'quoted'") == ["quoted"]
    assert tokenise("...") == []
