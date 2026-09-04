"""SubjectRank inference API.

The same ranking the Next.js route serves, over HTTP, so the frontend can deploy
to Vercel while inference runs on Azure.

**It reuses `subjectrank.features` and `subjectrank.ranking` directly** — the same
modules the training pipeline uses. That is the point: no reimplementation, so
the features this service extracts are by construction the features the model was
fitted on. Reimplementing extraction here would recreate the exact
training/serving skew the parity suite exists to police.

What it deliberately does not do:
  * never return an absolute score, a predicted open rate, or a "confidence out
    of 100" — the model is pairwise and cannot produce one (D-002);
  * never invent attribution for a feature the model does not use (D-012).
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import sys
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from subjectrank.features import (  # noqa: E402
    FEATURE_SPEC_VERSION, extract, feature_names, normalise,
)

MODEL_DIR = pathlib.Path(os.environ.get("MODEL_DIR", ROOT / "web" / "model"))

MIN_LINES = 2
MAX_LINES = 5
MAX_CHARS = 200

# Same constant the web app and the training pipeline use. Below this gap in
# aggregate score we say the model cannot separate two lines rather than
# inventing an order.
TOO_CLOSE_THRESHOLD = 0.04

_state: Dict[str, Any] = {}


def _load() -> None:
    """Load the promoted champion once, at startup.

    Loading at import time rather than per request matters: ONNX session
    creation was measured at ~2.5s in this project, which would otherwise land
    on the first user of every cold container.
    """
    meta_path = MODEL_DIR / "champion.meta.json"
    onnx_path = MODEL_DIR / "champion.onnx"
    if not (meta_path.exists() and onnx_path.exists()):
        raise RuntimeError(
            f"No champion model in {MODEL_DIR}. Promote one first: "
            f"python ml/scripts/promote_model.py"
        )

    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    # A model trained under one feature spec must never be served by an
    # extractor at another. Refusing to start beats serving silently-wrong
    # numbers for the life of the container.
    if meta.get("feature_spec_version") != FEATURE_SPEC_VERSION:
        raise RuntimeError(
            f"Feature spec mismatch: model is v{meta.get('feature_spec_version')}, "
            f"extractor is v{FEATURE_SPEC_VERSION}. Refusing to serve."
        )

    import onnxruntime as ort

    so = ort.SessionOptions()
    so.log_severity_level = 3
    session = ort.InferenceSession(
        str(onnx_path), sess_options=so, providers=["CPUExecutionProvider"]
    )

    names = feature_names()
    # The ONNX graph is positional. Map the model's feature list onto the
    # extractor's full vector once, here, rather than trusting the orders match.
    keep = [names.index(n) for n in meta["feature_names"]]

    _state.update(
        session=session,
        meta=meta,
        keep=keep,
        sha256=hashlib.sha256(onnx_path.read_bytes()).hexdigest(),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load()
    yield
    _state.clear()


app = FastAPI(
    title="SubjectRank API",
    version="1.0.0",
    summary="Pairwise subject-line comparison. Ranks lines against each other; never scores one.",
    description=(
        "Trained on 27,616 randomised A/B tests of headlines Upworthy ran between "
        "2013 and 2015 (Matias et al., Sci Data 8, 195, CC BY 4.0).\n\n"
        "**This API cannot return an open rate or a score.** The model is pairwise "
        "and structurally incapable of producing an absolute number. Where it "
        "cannot statistically separate two lines it says so rather than inventing "
        "an order."
    ),
    lifespan=lifespan,
)

# The browser calls this cross-origin from Vercel. Explicit allowlist rather
# than "*": the API sets no cookies and holds no secrets, but an open CORS
# policy on a service that later gains either is a bug waiting to be written.
_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["http://localhost:3000", "http://localhost:3111"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["content-type"],
)


# ── schema ──────────────────────────────────────────────────────────────────

class CompareRequest(BaseModel):
    lines: List[str] = Field(
        ...,
        description=f"Between {MIN_LINES} and {MAX_LINES} subject lines.",
        examples=[["Why your best customers leave",
                   "The one chart that explains your churn"]],
    )
    includeInternals: bool = Field(
        False,
        description=(
            "Include the raw feature vector and the pairwise aggregate under an "
            "`internals` object. OFF by default and deliberately so. "
            "This exists for one caller: the frontend's own server route, which "
            "persists these for later evaluation of whether the ranking was any "
            "good. The in-process path always stored them, and losing them when "
            "inference moved behind HTTP would have quietly degraded the "
            "evaluation data without anyone noticing. "
            "It is NOT a way to get a score for a subject line. The aggregate is "
            "a Borda count over pairwise probabilities -- it is meaningful only "
            "relative to the other lines in the same request, it changes if you "
            "change them, and it is not an open rate or a quality score. Nothing "
            "in the product renders it, and the field is named `internals` so "
            "that anyone tempted to display it has to first explain why."
        ),
    )


class Reason(BaseModel):
    kind: str = Field(description="helps | hurts | no-effect | not-measured")
    text: str = Field(description="Plain language. Never a feature name.")
    feature: str
    mine: Optional[float] = Field(None, description="This line's value")
    theirs: Optional[float] = Field(None, description="Mean over the other lines")


class RankedLineOut(BaseModel):
    index: int = Field(description="Position in the submitted array")
    text: str
    normalisedText: str = Field(description="What the features were computed on")
    rank: int
    placing: str = Field(
        description="'1st', or a RANGE like '1st-2nd' when the model cannot "
                    "separate this line from another. Never a score."
    )
    placingExact: bool
    reasons: List[Reason]
    charCount: int
    internals: Optional[Dict[str, Any]] = Field(
        None,
        description="Only when includeInternals=true. Not for display.",
    )


class CompareResponse(BaseModel):
    modelVersion: str
    featureSpecVersion: int
    lines: List[RankedLineOut]
    tooCloseToCall: List[List[int]] = Field(
        description="Adjacent pairs the model cannot statistically separate."
    )
    trainingCharMedian: Optional[int]
    excludedFeatures: List[str] = Field(
        description="Features dropped for insufficient training support. The API "
                    "has no opinion about these at all (D-012)."
    )
    inferenceMs: float


# ── ranking ─────────────────────────────────────────────────────────────────

def _predict(diffs: np.ndarray) -> np.ndarray:
    sess = _state["session"]
    out = sess.run(None, {sess.get_inputs()[0].name: np.asarray(diffs, dtype=np.float32)})
    for o in out:
        arr = np.asarray(o)
        if arr.ndim == 2 and arr.shape[1] == 2:
            return arr[:, 1].astype(np.float64)
    raise RuntimeError("ONNX graph produced no probability output")


def _placings(scores: List[float]) -> List[Dict[str, Any]]:
    """A placing is a RANGE unless the model earned a single number.

    `lo` counts the lines that beat this one decisively; `hi` counts the ones it
    beats decisively. Deliberately not a transitive tie-grouping: with scores
    .60/.57/.54 at a .04 threshold the first and last ARE separable even though
    neither is separable from the middle, and chaining them would report the top
    line as possibly-third.
    """
    n = len(scores)
    out = []
    for i, s in enumerate(scores):
        beaten_by = sum(1 for j, o in enumerate(scores)
                        if j != i and o > s and abs(o - s) >= TOO_CLOSE_THRESHOLD)
        beats = sum(1 for j, o in enumerate(scores)
                    if j != i and o < s and abs(o - s) >= TOO_CLOSE_THRESHOLD)
        lo, hi = beaten_by + 1, n - beats
        out.append({"lo": lo, "hi": hi, "exact": lo == hi})
    return out


ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"]
_ord = lambda k: ORDINALS[k - 1] if k <= len(ORDINALS) else f"{k}th"  # noqa: E731


@app.post("/v1/compare", response_model=CompareResponse, tags=["compare"])
def compare(req: CompareRequest) -> CompareResponse:
    t0 = time.perf_counter()

    lines = [s.strip() for s in req.lines if isinstance(s, str) and s.strip()]
    include_internals = req.includeInternals
    if len(lines) < MIN_LINES:
        raise HTTPException(
            422, f"Give at least {MIN_LINES} lines — this compares them against each other."
        )
    if len(lines) > MAX_LINES:
        raise HTTPException(422, f"That is more than {MAX_LINES} lines. Drop a few and compare again.")
    too_long = next((l for l in lines if len(l) > MAX_CHARS), None)
    if too_long:
        raise HTTPException(422, f"One line is {len(too_long)} characters. The limit is {MAX_CHARS}.")

    meta, keep = _state["meta"], _state["keep"]

    # Rank the NORMALISED form, so what is returned, what the features were
    # computed on, and the reported character count are all the same string.
    normalised = [normalise(s) for s in lines]
    full = np.asarray([extract(s) for s in normalised], dtype=np.float64)
    reduced = full[:, keep]

    n = len(lines)
    pairs = [(i, j) for i in range(n) for j in range(n) if i != j]
    probs = _predict(np.asarray([reduced[i] - reduced[j] for i, j in pairs]))

    P = np.full((n, n), 0.5)
    for (i, j), p in zip(pairs, probs):
        P[i, j] = p
    off = ~np.eye(n, dtype=bool)
    scores = [float(P[i][off[i]].mean()) for i in range(n)]

    order = sorted(range(n), key=lambda i: (-scores[i], i))
    placings = _placings(scores)

    names = feature_names()
    feature_maps = [dict(zip(names, row)) for row in full]

    out_lines: List[RankedLineOut] = []
    for rank_pos, i in enumerate(order):
        others = [fm for k, fm in enumerate(feature_maps) if k != i]
        reasons = _reasons(meta, feature_maps[i], others)
        pl = placings[i]
        out_lines.append(RankedLineOut(
            index=i,
            text=lines[i],
            normalisedText=normalised[i],
            rank=rank_pos + 1,
            placing=_ord(pl["lo"]) if pl["exact"] else f'{_ord(pl["lo"])}–{_ord(pl["hi"])}',
            placingExact=pl["exact"],
            reasons=reasons,
            charCount=int(feature_maps[i].get("char_count", 0)),
            internals=None if not include_internals else {
                "features": feature_maps[i],
                # Named "pairwiseAggregate", never "score": it is a mean over
                # this line's win probability against the OTHER lines in this
                # request, so it has no meaning outside this set of lines.
                "pairwiseAggregate": scores[i],
                "pairwise": {str(j): float(P[i, j]) for j in range(n) if j != i},
            },
        ))

    too_close: List[List[int]] = []
    for a in range(len(out_lines) - 1):
        ia, ib = out_lines[a].index, out_lines[a + 1].index
        if abs(scores[ia] - scores[ib]) < TOO_CLOSE_THRESHOLD:
            too_close.append([ia, ib])

    return CompareResponse(
        modelVersion=meta["version"],
        featureSpecVersion=meta["feature_spec_version"],
        lines=out_lines,
        tooCloseToCall=too_close,
        trainingCharMedian=meta.get("training_char_median"),
        excludedFeatures=meta.get("excluded_features", []),
        inferenceMs=round((time.perf_counter() - t0) * 1000, 3),
    )


def _reasons(meta: Dict, mine: Dict[str, float],
             others: List[Dict[str, float]], limit: int = 3) -> List[Reason]:
    """Exact per-feature attribution for a linear model.

    Two rules, both from real bugs:

      * the factual clause describes the DIFFERENCE, the verdict describes the
        CONTRIBUTION. They have different signs, and conflating them once
        rendered "82 characters - shorter than the others" beside the number
        that disproved it;
      * a model that cannot supply coefficients says so rather than rendering an
        empty list, which reads as "nothing to say".
    """
    coefs, scale = meta.get("coefficients"), meta.get("scale")
    if not coefs or not scale:
        return [Reason(
            kind="no-effect", feature="__no_attribution__",
            text=("This model does not expose an exact per-feature breakdown, so "
                  "there is no reasoning to show for this line."),
        )]

    scored = []
    for idx, name in enumerate(meta["feature_names"]):
        raw_scale = scale[idx]
        if not raw_scale:
            continue
        m = float(mine.get(name, 0.0))
        t = (sum(float(o.get(name, 0.0)) for o in others) / len(others)) if others else 0.0
        delta = m - t
        if abs(delta) < 1e-12:
            continue
        contribution = (coefs[idx] * delta) / raw_scale
        if abs(contribution) < 1e-9:
            continue
        scored.append((abs(contribution), Reason(
            kind="helps" if contribution > 0 else "hurts",
            text=_describe(name, delta, m),
            feature=name, mine=m, theirs=t,
        )))

    scored.sort(key=lambda x: -x[0])
    top = [r for _, r in scored[:limit]]

    # The fourth state. Triggered by the model not USING the emoji features, so
    # an artifact that simply omits them still produces the note (D-012).
    emoji_feats = ("has_emoji", "emoji_count", "emoji_leading", "emoji_trailing")
    uses_emoji = any(f in meta["feature_names"] for f in emoji_feats)
    line_has_emoji = (mine.get("has_emoji", 0) or mine.get("emoji_count", 0)) > 0
    if not uses_emoji and line_has_emoji:
        top.append(Reason(
            kind="not-measured", feature="has_emoji",
            text=("Nothing to say about the emoji — it appears in almost none of "
                  "the headlines this model learned from, so any opinion would be "
                  "made up."),
        ))
    return top


# Plain language for every feature the champion uses. A feature with no phrase
# would render its own internal name at a reader; `parity/phrases_check.ts`
# enforces the same rule on the TypeScript side.
_PHRASES: Dict[str, tuple] = {
    "char_count": ("longer than the others you gave us", "shorter than the others you gave us"),
    "word_count": ("more words than the others", "fewer words than the others"),
    "mean_word_len": ("longer words", "shorter words"),
    "max_word_len": ("contains a longer word", "no long words"),
    "long_word_ratio": ("several long words", "few long words"),
    "second_person_count": ("speaks to the reader directly", "less second person than the others"),
    "first_person_sing_count": ("first person singular", "no first person"),
    "first_person_plur_count": ('speaks as "we"', 'does not speak as "we"'),
    "third_person_count": ("third person", "no third person"),
    "wh_word_count": ("opens a question", "no question framing"),
    "demonstrative_count": ("demonstratives", "no demonstratives"),
    "leading_demonstrative": ("opens on a demonstrative, which leaves a gap to close",
                              "does not open on a demonstrative"),
    "has_question": ("contains a question mark", "no question mark"),
    "ends_question": ("ends on a question mark", "does not end on a question"),
    "has_exclamation": ("contains an exclamation mark", "no exclamation mark"),
    "exclamation_count": ("more exclamation marks", "fewer exclamation marks"),
    "ends_exclamation": ("ends on an exclamation mark", "does not end on an exclamation"),
    "has_ellipsis": ("trails off", "does not trail off"),
    "ends_ellipsis": ("ends on an ellipsis", "does not end on an ellipsis"),
    "has_digit": ("contains a number", "no number"),
    "digit_count": ("more digits", "fewer digits"),
    "starts_with_digit": ("opens on a number", "does not open on a number"),
    "leading_number_magnitude": ("opens on a larger number", "opens on a smaller number"),
    "upper_char_ratio": ("heavier capitalisation", "lighter capitalisation"),
    "allcaps_word_count": ("words in full capitals", "no words in full capitals"),
    "title_case_ratio": ("more title case", "less title case"),
    "superlative_count": ("superlatives", "no superlatives"),
    "intensifier_count": ("intensifiers", "no intensifiers"),
    "polarity_sum": ("more positive wording", "more negative wording"),
    "polarity_abs_sum": ("more emotive wording", "flatter wording"),
    "polarity_pos_count": ("more positive words", "fewer positive words"),
    "polarity_neg_count": ("more negative words", "fewer negative words"),
    "flesch_reading_ease": ("reads more easily", "harder to read"),
    "syllable_count": ("more syllables", "fewer syllables"),
    "mean_syllables_per_word": ("longer words", "shorter words"),
    "has_colon": ("a colon splits it into a label and a payload", "no colon"),
    "comma_count": ("more commas", "fewer commas"),
    "has_quote": ("contains a quotation", "no quotation"),
    "has_dash": ("contains a dash", "no dash"),
    "non_ascii_ratio": ("more non-Latin characters", "fewer non-Latin characters"),
    "ft_wh": ("opens on a question word", "does not open on a question word"),
    "ft_determiner": ('opens on "the", "this" or "a"', 'does not open on "the", "this" or "a"'),
    "ft_pronoun": ("opens on a pronoun", "does not open on a pronoun"),
    "ft_preposition": ("opens on a preposition", "does not open on a preposition"),
    "ft_auxiliary": ('opens on "is", "can" or another auxiliary', "does not open on an auxiliary"),
    "ft_numeral": ("opens on a number", "does not open on a number"),
    "ft_verb_common": ('opens on a verb, like "watch" or "meet"', "does not open on a verb"),
    "ft_other": ("opens on a word outside the common openers", "opens on one of the common openers"),
}


def _describe(feature: str, delta: float, value: float) -> str:
    phrase = _PHRASES.get(feature)
    if not phrase:
        return ("more of a property we have not written a plain description for yet"
                if delta > 0 else
                "less of a property we have not written a plain description for yet")
    base = phrase[0] if delta > 0 else phrase[1]
    if feature == "char_count":
        return f"{round(value)} characters — {base}"
    return base


# ── health ──────────────────────────────────────────────────────────────────

@app.get("/v1/health", tags=["ops"])
def health() -> Dict[str, Any]:
    """Readiness. Reports which model is live and its hash.

    After a deploy the fastest way to answer "which model is actually serving?"
    should be a curl, not a pipeline log.
    """
    if "session" not in _state:
        return JSONResponse({"ok": False, "reason": "no-model"}, status_code=503)
    meta = _state["meta"]
    return {
        "ok": True,
        "model": meta["version"],
        "algorithm": meta.get("algorithm"),
        "featureSpecVersion": meta["feature_spec_version"],
        "extractorSpecVersion": FEATURE_SPEC_VERSION,
        "features": len(meta["feature_names"]),
        "excluded": len(meta.get("excluded_features", [])),
        "artifactSha256": _state["sha256"],
    }


@app.get("/", include_in_schema=False)
def root() -> Dict[str, str]:
    return {"service": "subjectrank-api", "docs": "/docs", "health": "/v1/health"}


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    """Errors say what happened and how to fix it, and do not apologise."""
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)
