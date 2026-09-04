"""Build parity/corpus.json -- the frozen string corpus both extractors run on.

Deterministic by construction: a fixed hand-written list plus systematic
combinations. No randomness, no sampling, no timestamps. Re-running this script
must produce a byte-identical file or the corpus is not frozen.

The corpus is adversarial on purpose. Its job is not to look like typical input --
it is to find the places where a Python implementation and a TypeScript
implementation of the same spec quietly disagree. Every category below exists
because it is a known way for the two runtimes to differ.
"""
import json
import pathlib
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "parity" / "corpus.json"

entries = []


def add(text, why):
    entries.append({"text": text, "why": why})


# --- 1. Ordinary input: viral-media headlines (the training domain) ---------
for h in [
    "This Is What Happens When You Give A Homeless Man A Second Chance",
    "9 Things You Didn't Know About Your Own Body",
    "Watch This Little Girl Explain Feminism Better Than Most Adults",
    "He Thought Nobody Was Watching. He Was Wrong.",
    "Why Do We Still Believe This Myth About Sleep?",
    "The One Chart That Explains Everything About Income Inequality",
    "She Asked A Simple Question. The Answer Broke My Heart.",
    "I Was Skeptical Too, Until I Saw The Second Photo",
    "It Turns Out Everything You've Heard About Fat Is Wrong",
    "WATCH: What This Teacher Did Will Restore Your Faith In Humanity",
]:
    add(h, "domain: viral headline")

# --- 2. Ordinary input: email subject lines (the serving domain) -----------
for s in [
    "Your March invoice is ready",
    "quick question",
    "Re: following up on our call",
    "You left something in your cart",
    "3 things I learned building in public this month",
    "We're shutting down. Here's what happens to your data.",
    "[Action required] Verify your email address",
    "Last chance: 40% off ends tonight",
    "how's it going?",
    "Introducing our new pricing",
]:
    add(s, "domain: email subject line")

# --- 3. Empty and whitespace pathologies -----------------------------------
add("", "empty string")
add(" ", "single space")
add("   ", "multiple spaces")
add("\t\n\r ", "assorted ASCII whitespace only")
add(" ", "NBSP only")
add("　", "ideographic space only")
add("  leading and trailing  ", "trim behaviour")
add("collapse     these     runs", "internal run collapse")
add(" line separator", "LINE/PARAGRAPH SEPARATOR treated as whitespace")
add("mixed   spacing", "NBSP + thin + hair space")
add("﻿BOM at start", "BOM is zero-width, not whitespace")

# --- 4. Unicode normalisation ----------------------------------------------
for base in ["café", "naïve", "résumé", "Zoë", "piñata"]:
    add(unicodedata.normalize("NFC", base), "NFC form")
    add(unicodedata.normalize("NFD", base), "NFD form - must match its NFC twin")
add("Å", "A + COMBINING RING = Å under NFC")
add("ẛ̣", "NFC edge case: long s with dot")

# --- 5. Emoji ---------------------------------------------------------------
add("\U0001f600", "single emoji")
add("\U0001f631\U0001f631", "two adjacent identical emoji -> 2 clusters")
add("\U0001f600\U0001f601\U0001f602", "three distinct adjacent emoji -> 3 clusters")
add("\U0001f468‍\U0001f469‍\U0001f467‍\U0001f466", "ZWJ family -> 1 cluster")
add("\U0001f469‍\U0001f4bb", "ZWJ profession -> 1 cluster")
add("\U0001f44b\U0001f3fd", "skin tone modifier -> 1 cluster")
add("\U0001f44b\U0001f3fb\U0001f44b\U0001f3ff", "two toned emoji -> 2 clusters")
add("\U0001f1fa\U0001f1f8", "flag: regional indicator pair -> 1 cluster")
add("\U0001f1fa\U0001f1f8\U0001f1ec\U0001f1e7", "two flags -> 2 clusters")
add("\U0001f1fa", "lone regional indicator")
add("1️⃣", "keycap sequence")
add("❤️", "heart with VS16")
add("❤︎", "heart with VS15 (text presentation)")
add("\U0001f525 Sale ends today \U0001f525", "emoji at both ends")
add("Really?? \U0001f389", "terminal punctuation behind a trailing emoji")
add("Done!\U0001f44d", "exclamation then emoji, no space")
add("© 2026 Acme", "(c) deliberately NOT emoji - see emoji_ranges.json")
add("Grade: A™", "(tm) deliberately NOT emoji")
add("⭐ Featured", "star IS emoji")

# --- 6. Scripts -------------------------------------------------------------
for t, why in [
    ("مرحبا بالعالم", "Arabic (RTL, uncased)"),
    ("שלום עולם", "Hebrew (RTL, uncased)"),
    ("नमस्ते दुनिया", "Devanagari"),
    ("こんにちは世界", "Japanese (no spaces)"),
    ("你好世界", "Chinese"),
    ("안녕하세요 세계", "Korean"),
    ("Привет мир", "Cyrillic (cased)"),
    ("Γειά σου Κόσμε", "Greek (cased)"),
    ("สวัสดีชาวโลก", "Thai (no spaces)"),
    ("Xin chào thế giới", "Vietnamese (heavy diacritics)"),
    ("English and العربية mixed", "mixed script + bidi"),
    ("Hello 世界 \U0001f30f", "Latin + CJK + emoji"),
]:
    add(t, "script: " + why)

# --- 7. Case edge cases -----------------------------------------------------
add("İstanbul", "Turkish dotted capital I - Python/JS lowercase differ historically")
add("STRASSE", "all caps")
add("Straße", "German sharp s - uppercases to two chars")
add("ΟΔΟΣ", "Greek caps - final sigma resolution on lowercase")
add("Σοφία", "Greek mixed case")
add("ǅungla", "titlecase character (category Lt)")
add("ALL CAPS HEADLINE HERE", "allcaps_word_count")
add("A B C D", "single-letter tokens are not allcaps (needs >=2 cased)")
add("iPhone vs ANDROID", "mixed casing within line")

# --- 8. Digits --------------------------------------------------------------
add("9 reasons to switch", "ASCII leading digit")
add("2015 was a strange year", "leading year - magnitude cap")
add("99999999 things", "magnitude cap at 1000")
add("١٢٣ عناصر", "Arabic-Indic digits (Nd, non-ASCII)")
add("१२३ चीजें", "Devanagari digits (Nd)")
add("１２３ items", "fullwidth digits (Nd)")
# Value-9 digits specifically. Their absence let a real bug through: the TS
# DIGIT_VALUE loop stopped one code point short of the block boundary, so any
# non-ASCII digit with value 9 resolved to 0 while Python returned 9. Every
# non-ASCII digit case in the corpus happened to be 1, 2 or 3.
add("٩ طرق لتوفير المال", "Arabic-Indic NINE - the off-by-one case")
add("٩", "Arabic-Indic nine alone")
add("९ तरीके", "Devanagari NINE")
add("９ ways", "fullwidth NINE")
add("١٩ things", "Arabic-Indic nineteen - two-digit, ends in 9")
add("٠٩ leading zero", "Arabic-Indic zero-nine")
add("²³ superscript", "superscript digits are No, NOT Nd - must not count")
add("Ⅷ roman numeral", "Nl, not Nd")
add("½ portion", "vulgar fraction is No, not Nd")
add("Top 10", "trailing number, not leading")

# --- 9. Punctuation ---------------------------------------------------------
add("What?", "ASCII question")
add("What？", "fullwidth question")
add("Wow!!!", "repeated exclamation")
add("Wow！！", "fullwidth exclamation")
add("Wait for it...", "three dots")
add("Wait for it…", "ellipsis character")
add("Wait for it....", "four dots")
add("a,b，c", "ASCII + fullwidth comma")
add("Breaking: it happened", "colon")
add('She said "no"', "straight double quotes")
add("She said “no”", "curly double quotes")
add("don't stop", "straight apostrophe")
add("don’t stop", "curly apostrophe - must fold to the same token")
add("well-known co-founder", "hyphens")
add("em — dash", "em dash")
add("en – dash", "en dash")
add("...", "punctuation only, no tokens")
add("?!?!", "punctuation only, terminal detection with no tokens")

# --- 10. Zero-width and invisible ------------------------------------------
add("zero​width​space", "ZWSP does not split tokens but is not counted")
add("zero‌width‌nonjoiner", "ZWNJ")
add("a‍b", "ZWJ between non-emoji")
add("​", "ZWSP only")

# --- 11. Length extremes ----------------------------------------------------
add("a", "single char")
add("I", "single uppercase char")
add("x" * 500, "long single token")
add(("word " * 200).strip(), "many tokens")
add("a" * 3 + " " + "b" * 3, "short tokens")
add("supercalifragilisticexpialidocious", "long word, syllable counting")
add("rhythm", "no vowels except y")
add("queue", "vowel run")
add("the", "silent-e rule must not fire (count would drop to 0)")
add("apple", "silent e")
add("little", "-le exception to silent e")
add("code", "silent e")

# --- 12. Lexicon and negation ----------------------------------------------
add("This is not good", "negation flips polarity within window")
add("This is not at all good", "negator outside 3-token window - no flip")
add("no good very bad day", "multiple negators")
add("You won't believe what happened", "contraction negator")
add("assess the class", "substring trap: 'ass' must not match as a token")
add("Nothing is impossible", "negator as first token")
add("The best and the worst", "superlatives")
add("really very literally amazing", "stacked intensifiers")
add("What happened next will shock you", "wh + second person + curiosity")
add("This changed everything", "leading demonstrative")
add("Everything about this changed", "demonstrative outside first 3 tokens")

# --- 13. First-token class --------------------------------------------------
for t, why in [
    ("The truth about sugar", "determiner"),
    ("Why we quit", "wh"),
    ("You should read this", "pronoun"),
    ("In defence of boredom", "preposition"),
    ("Is this the end?", "auxiliary"),
    ("7 lessons", "numeral"),
    ("Watch what happens", "verb_common"),
    ("Bananas are strange", "other"),
]:
    add(t, "first token: " + why)

# --- 14. Systematic combinations -------------------------------------------
# Cross a small set of stems with a small set of suffixes so that per-feature
# interactions get exercised without hand-writing every case.
stems = ["This is the truth", "9 secrets", "Why you failed", "WATCH now"]
suffixes = ["", "?", "!", "...", " \U0001f525", "…", "!!!", " \U0001f1fa\U0001f1f8"]
for s in stems:
    for suf in suffixes:
        add(s + suf, "systematic: stem x terminal")

seen, deduped = set(), []
for e in entries:
    if e["text"] in seen:
        continue
    seen.add(e["text"])
    deduped.append(e)

OUT.parent.mkdir(parents=True, exist_ok=True)
payload = {
    "note": "Frozen parity corpus. Deterministic: regenerating must be byte-identical. "
            "Add cases by editing ml/scripts/build_parity_corpus.py, never this file.",
    "count": len(deduped),
    "entries": deduped,
}
OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)}: {len(deduped)} unique strings")
