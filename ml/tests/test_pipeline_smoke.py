"""End-to-end pipeline smoke test on SYNTHETIC data.

Purpose: prove every stage wires together -- load, clean, image-match filter, pair,
z-test label, group split, temporal split, train, evaluate, export, verify -- before
the real archive arrives, so that when it does the only unknown is the numbers.

The synthetic archive has a real signal planted in it (shorter headlines and
question marks get a higher true CTR) so the metrics are meaningfully non-trivial.

NOTHING here may ever be reported as a model result. The fixture writes to a temp
directory, is labelled synthetic in every artifact it produces, and no number it
generates is allowed anywhere near MODEL_CARD.md.
"""
from __future__ import annotations

import json
import pathlib
import sys

import numpy as np
import pandas as pd
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from subjectrank import data as D  # noqa: E402
from subjectrank.config import CONFIG, Config  # noqa: E402
from subjectrank.dataset import build_xy, feature_support  # noqa: E402
from subjectrank.evaluate import full_report  # noqa: E402
from subjectrank.export_onnx import export_and_verify  # noqa: E402
from subjectrank.labels import alpha_sweep, label_pairs  # noqa: E402
from subjectrank.models import make_baseline, prob_fn  # noqa: E402
from subjectrank.splits import (LeakageError, assert_no_test_overlap,  # noqa: E402
                                group_folds, temporal_split)

WORDS = ("truth secret reason why this that watch amazing simple quick real story "
         "moment change proof answer").split()


def synth_archive(n_tests=600, seed=7) -> pd.DataFrame:
    rs = np.random.RandomState(seed)
    rows = []
    for t in range(n_tests):
        test_id = f"t{t:05d}"
        # Two images per test, so the D-003 filter has cross-image pairs to reject.
        for img in (f"img{t:05d}a", f"img{t:05d}b"):
            for _ in range(rs.randint(2, 5)):
                k = rs.randint(3, 14)
                h = " ".join(rs.choice(WORDS, size=k))
                if rs.rand() < 0.35:
                    h += "?"
                # Planted signal: shorter is better, question marks help.
                logit = -0.06 * len(h) + 0.35 * h.endswith("?") - 2.9
                p = 1 / (1 + np.exp(-logit))
                imps = int(rs.randint(400, 6000))
                rows.append({
                    "clickability_test_id": test_id,
                    "eyecatcher_id": img,
                    "headline": h,
                    "impressions": imps,
                    "clicks": int(rs.binomial(imps, p)),
                    "created_at": pd.Timestamp("2013-01-01", tz="UTC")
                                  + pd.Timedelta(days=int(t * 0.8)),
                    "problem": 0,
                    "winner": rs.randint(0, 2),      # banned column, must be ignored
                    "significance": rs.rand(),        # banned column
                })
    return pd.DataFrame(rows)


@pytest.fixture(scope="module")
def prepared():
    cfg = Config()
    df = synth_archive()
    df["__subset"] = "synthetic"
    ledger = D.Ledger()
    arms = D.clean(df, cfg, ledger)
    pairs_all = D.build_pairs(arms, cfg, ledger)
    pairs = label_pairs(pairs_all, cfg, ledger=ledger)
    return {"cfg": cfg, "arms": arms, "pairs_all": pairs_all,
            "pairs": pairs, "ledger": ledger}


def test_pipeline_produces_usable_pairs(prepared):
    p = prepared["pairs"]
    assert len(p) > 500, f"only {len(p)} pairs -- fixture too small to be meaningful"
    assert prepared["ledger"].to_markdown().count("|") > 10


def test_image_filter_actually_bites(prepared):
    """Every pair must share an image. This is D-003 and it is the whole ballgame."""
    p = prepared["pairs"]
    arms = prepared["arms"]
    assert p["image_id"].notna().all()
    # Confirm the filter removed something: without it there would be strictly more
    # pairs, because each synthetic test has two images whose arms could be crossed.
    per_group = arms.groupby(["clickability_test_id", "eyecatcher_id"]).size()
    per_test = arms.groupby("clickability_test_id").size()
    max_within_image = int((per_group * (per_group - 1) // 2).sum())
    max_within_test = int((per_test * (per_test - 1) // 2).sum())
    assert max_within_image < max_within_test, "fixture has no cross-image pairs to reject"


def test_pairs_never_cross_tests(prepared):
    p = prepared["pairs"]
    assert p["test_id"].notna().all()


def test_alpha_sweep_is_monotone(prepared):
    sw = alpha_sweep(prepared["pairs_all"], prepared["cfg"])
    assert sw["pairs"].is_monotonic_increasing, "looser alpha must keep more pairs"
    assert sw["pairs"].iloc[0] < sw["pairs"].iloc[-1]


def test_augmentation_is_exactly_antisymmetric(prepared):
    X, y, g, names = build_xy(prepared["pairs"], prepared["cfg"], augment=True)
    n = len(prepared["pairs"])
    assert X.shape[0] == 2 * n
    assert np.allclose(X[:n], -X[n:])
    assert np.array_equal(y[:n], 1 - y[n:])
    assert abs(y.mean() - 0.5) < 1e-12, "augmented labels must balance exactly"


def test_banned_columns_never_reach_features(prepared):
    _, _, _, names = build_xy(prepared["pairs"], prepared["cfg"])
    for banned in ("impressions", "clicks", "winner", "significance", "first_place"):
        assert not any(banned in n for n in names)


def test_group_split_has_no_test_overlap(prepared):
    pairs = prepared["pairs"]
    for tr, te in group_folds(pairs, prepared["cfg"]):
        assert_no_test_overlap(pairs.iloc[tr], pairs.iloc[te])


def test_row_split_is_detected_as_leakage(prepared):
    """The guard must actually fire -- a leak detector that never fires is not one."""
    pairs = prepared["pairs"]
    rs = np.random.RandomState(0)
    idx = rs.permutation(len(pairs))
    half = len(idx) // 2
    with pytest.raises(LeakageError):
        assert_no_test_overlap(pairs.iloc[idx[:half]], pairs.iloc[idx[half:]])


def test_temporal_split_is_forward_in_time(prepared):
    pairs = prepared["pairs"]
    tr, te, cutoff = temporal_split(pairs, prepared["cfg"])
    assert len(te) > 0 and len(tr) > 0
    assert pairs.iloc[tr]["created_at"].max() <= pairs.iloc[te]["created_at"].max()
    assert not (set(pairs.iloc[tr]["test_id"]) & set(pairs.iloc[te]["test_id"]))


def test_model_learns_the_planted_signal_and_exports(prepared, tmp_path):
    cfg, pairs, arms = prepared["cfg"], prepared["pairs"], prepared["arms"]
    X, y, g, names = build_xy(pairs, cfg, augment=True)
    tr, te, _ = temporal_split(pairs, cfg)
    n = len(pairs)
    tr_a = np.concatenate([tr, tr + n])
    te_a = np.concatenate([te, te + n])

    m = make_baseline(cfg)
    m.fit(X[tr_a], y[tr_a])
    rep = full_report(prob_fn(m), X[te_a], y[te_a], arms,
                      set(pairs.iloc[te]["test_id"]),
                      ["short one?", "a much longer headline than the other one here"])

    # The signal is planted, so a working pipeline must find it. This is a wiring
    # test, not a performance claim -- these numbers describe synthetic data.
    assert rep["pairwise"]["accuracy"] > 0.60
    assert rep["pairwise"]["roc_auc"] > 0.65
    assert rep["selection"]["top1_accuracy"] > rep["selection"]["top1_baseline_random"]
    assert rep["lift"]["lift_vs_mean_pct"] > 0
    assert rep["antisymmetry_max_violation"] < cfg.antisymmetry_tolerance
    assert np.isfinite(rep["calibration"]["brier"])

    corpus = [e["text"] for e in json.loads(
        (ROOT / "parity" / "corpus.json").read_text(encoding="utf-8"))["entries"]]
    r = export_and_verify(m, list(range(len(names))), names,
                          tmp_path / "smoke.onnx", corpus, cfg,
                          metadata={"synthetic": "true"})
    assert r["passed"]
    assert r["max_abs_delta"] < cfg.onnx_parity_tolerance
    assert r["antisymmetry_max_violation"] < cfg.antisymmetry_tolerance


def test_loader_refuses_a_file_with_wrong_counts(tmp_path):
    """A truncated or mislabelled download must stop the run (D-001 verification)."""
    df = synth_archive(n_tests=5)
    p = tmp_path / "upworthy-archive-exploratory-packages-03.12.2020.csv"
    df.to_csv(p, index=False)
    with pytest.raises(D.DataError, match="published counts"):
        D.load_subset(p, "exploratory", verify=True)


def test_loader_refuses_missing_columns(tmp_path):
    df = synth_archive(n_tests=5).drop(columns=["eyecatcher_id"])
    p = tmp_path / "upworthy-archive-holdout-packages-03.12.2020.csv"
    df.to_csv(p, index=False)
    with pytest.raises(D.DataError, match="missing required columns"):
        D.load_subset(p, "holdout", verify=False)


def test_disabling_the_image_filter_is_refused(prepared):
    cfg = Config(require_same_image=False)
    with pytest.raises(D.DataError, match="image-confounded"):
        D.build_pairs(prepared["arms"], cfg, D.Ledger())
