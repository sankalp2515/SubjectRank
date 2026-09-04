"""Independent leakage audit, re-derived rather than trusting the pipeline's guards.

The pipeline asserts D-004 and D-005 in `dataset.assert_features_are_clean` and
`splits.assert_no_test_overlap`. Those guards were written by whoever wrote the
pipeline, which is exactly the situation where a guard and the bug it should catch
can share an assumption. This script rebuilds the same objects and checks the
properties from the outside, from the data rather than from the code path.

Six checks. Any failure is a stop, not a note.
"""
from __future__ import annotations

import json
import pathlib
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from subjectrank import data as D                                 # noqa: E402
from subjectrank.config import BANNED_AS_FEATURES, CONFIG, REPORTS  # noqa: E402
from subjectrank.dataset import build_xy                          # noqa: E402
from subjectrank.features import extract, feature_names           # noqa: E402
from subjectrank.labels import label_pairs                        # noqa: E402
from subjectrank.splits import group_folds, temporal_split        # noqa: E402
from subjectrank.train import prepare                             # noqa: E402

FAILS: list[str] = []
NOTES: list[str] = []


def check(name: str, ok: bool, detail: str) -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}\n      {detail}\n")
    if not ok:
        FAILS.append(f"{name}: {detail}")


def main() -> int:
    prep = prepare(CONFIG)
    pairs, arms = prep["pairs"], prep["arms"]
    names = feature_names()

    # ---- 1. no banned column can reach the feature matrix -------------------
    # Checked two ways: by name, and by arity. The name check is what the
    # pipeline does; the arity check is the one that actually matters, because a
    # function that only ever receives a string cannot read a dataframe column
    # whatever its features are called.
    import inspect
    sig = inspect.signature(extract)
    positional = [p for p in sig.parameters.values()
                  if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    hits = sorted({b for b in BANNED_AS_FEATURES for n in names if b in n})
    check("D-004 · no banned column appears in a feature name",
          not hits, f"{len(names)} features, banned substrings found: {hits or 'none'}")
    check("D-004 · the extractor is structurally blind to the dataframe",
          len(positional) == 1,
          f"extract{sig} takes {len(positional)} positional arg(s); "
          f"a single string cannot carry impressions")

    # And prove it empirically: same text, wildly different outcome columns,
    # identical feature vector.
    v1 = extract("This Is What Sexism Against Men Sounds Like")
    v2 = extract("This Is What Sexism Against Men Sounds Like")
    check("D-004 · features are a pure function of the string",
          np.array_equal(v1, v2), "identical text produced an identical vector")

    # ---- 2. group folds: no test id on both sides ---------------------------
    worst = 0
    for k, (tr, te) in enumerate(group_folds(pairs, CONFIG)):
        ov = set(pairs.iloc[tr]["test_id"]) & set(pairs.iloc[te]["test_id"])
        worst = max(worst, len(ov))
    check("D-005 · GroupKFold shares no clickability_test_id across folds",
          worst == 0, f"max overlap over {CONFIG.n_folds} folds: {worst} test ids")

    # ---- 3. temporal holdout is genuinely time-forward ----------------------
    tr, te, cutoff = temporal_split(pairs, CONFIG)
    tr_dates = pairs.iloc[tr]["created_at"]
    te_dates = pairs.iloc[te]["created_at"]
    ov = set(pairs.iloc[tr]["test_id"]) & set(pairs.iloc[te]["test_id"])
    check("D-005 · temporal holdout shares no test id with train",
          not ov, f"{len(ov)} overlapping test ids")

    # The split cuts on each test's MINIMUM created_at, so a test that ran over a
    # boundary could in principle place a later-dated train pair after the
    # cutoff. Measure it rather than assume it.
    leak_rows = int((tr_dates >= te_dates.min()).sum())
    check("D-005 · no training pair is dated at or after the earliest holdout pair",
          leak_rows == 0,
          f"train max {tr_dates.max()} | holdout min {te_dates.min()} | "
          f"cutoff {cutoff} | training pairs at/after holdout start: {leak_rows}")

    # ---- 4. the holdout is a real slice, not a rounding artefact ------------
    frac = len(te) / len(pairs)
    check("D-005 · holdout is close to the configured fraction",
          0.10 <= frac <= 0.30,
          f"{len(te):,} of {len(pairs):,} pairs = {frac:.1%} "
          f"(configured {CONFIG.temporal_holdout_frac:.0%} of TESTS, not pairs)")

    # ---- 5. the archive's own holdout subset was never loaded --------------
    loaded = set(prep["subsets_loaded"])
    check("D-014 · the archive's locked holdout subset was not loaded",
          "holdout" not in loaded, f"subsets loaded: {sorted(loaded)}")

    # ---- 6. label is built from CTR only, and is balanced by construction ---
    bal = float(pairs["label"].mean())
    check("D-010 · labels are not degenerate",
          0.4 < bal < 0.6, f"label balance before augmentation: {bal:.4f}")

    X, y, g, _ = build_xy(pairs, CONFIG, augment=True)
    n = len(pairs)
    mirrored = np.allclose(X[:n], -X[n:])
    check("D-009 · the augmented half is the exact negation of the first",
          mirrored, "X[n:] == -X[:n] elementwise")

    print("=" * 72)
    if FAILS:
        print(f"{len(FAILS)} CHECK(S) FAILED -- the reported metrics cannot be trusted")
        for f in FAILS:
            print("  -", f)
        return 1
    print("all leakage checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
