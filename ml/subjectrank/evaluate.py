"""The four metrics from the mission spec, plus calibration and antisymmetry.

Reported together, always. Pairwise accuracy alone flatters the model; top-1
selection accuracy is what the product actually does; realised CTR lift is the
only causal statement available; calibration is what makes the confidence
indicator honest rather than decorative.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Callable, Dict, List, Optional, Sequence

import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.metrics import brier_score_loss, roc_auc_score

from .ranking import antisymmetry_violation, rank


@dataclass
class PairwiseMetrics:
    n_pairs: int
    accuracy: float
    roc_auc: float
    brier: float


@dataclass
class SelectionMetrics:
    # The unit here is a (test, image) GROUP, not a test. D-003 only permits
    # comparison within one image, so a test that ran two images contributes two
    # independent decisions. Calling that count `n_tests` reported 2,287 "tests"
    # for a holdout containing 2,256 of them -- a number labelled as something it
    # was not. Both are now reported, under their own names.
    n_groups: int
    n_tests: int
    top1_accuracy: float
    top1_baseline_random: float
    mean_arms_per_group: float


@dataclass
class LiftMetrics:
    n_groups: int
    ctr_model_choice: float
    ctr_mean_arm: float
    ctr_best_arm: float
    ctr_worst_arm: float
    lift_vs_mean_pct: float
    lift_vs_worst_pct: float
    pct_of_oracle_gap_captured: float


def pairwise_metrics(y_true: np.ndarray, p: np.ndarray) -> PairwiseMetrics:
    y_true = np.asarray(y_true).astype(int).reshape(-1)
    p = np.asarray(p, dtype=np.float64).reshape(-1)
    pred = (p >= 0.5).astype(int)
    return PairwiseMetrics(
        n_pairs=int(len(y_true)),
        accuracy=float((pred == y_true).mean()),
        roc_auc=float(roc_auc_score(y_true, p)) if len(np.unique(y_true)) > 1 else float("nan"),
        brier=float(brier_score_loss(y_true, p)),
    )


def selection_and_lift(prob: Callable[[np.ndarray], np.ndarray],
                       arms: pd.DataFrame,
                       test_ids: Optional[Sequence] = None,
                       group_cols=("clickability_test_id", "eyecatcher_id"),
                       ) -> Dict:
    """Top-1 selection accuracy and realised CTR lift over held-out tests.

    Both are computed on GROUPS OF ARMS, not on pairs, because that is the shape
    of the real decision: a user hands us n lines and we must pick one.

    The lift figure is causal *within the Upworthy domain* and only there:
    assignment to arms was randomised, so comparing the CTR of the arm the model
    would have chosen against the mean arm is a comparison of randomised groups.
    It says nothing about 2026 email, and must never be reported as if it did.
    """
    df = arms if test_ids is None else arms[
        arms[group_cols[0]].isin(set(test_ids))]

    chosen, mean_c, best_c, worst_c = [], [], [], []
    hits, n_arms = 0, []
    evaluated_tests = set()

    for _, g in df.groupby(list(group_cols), sort=False):
        if len(g) < 2:
            continue
        texts = g["headline"].tolist()
        ctrs = g["ctr"].to_numpy(dtype=np.float64)
        if len(set(texts)) < 2:
            continue
        r = rank(prob, texts)
        pick = r["order"][0]
        truth = int(np.argmax(ctrs))

        hits += int(pick == truth)
        n_arms.append(len(g))
        evaluated_tests.add(g[group_cols[0]].iloc[0])
        chosen.append(ctrs[pick])
        mean_c.append(ctrs.mean())
        best_c.append(ctrs.max())
        worst_c.append(ctrs.min())

    n = len(n_arms)
    if n == 0:
        return {"selection": None, "lift": None}

    chosen_m = float(np.mean(chosen))
    mean_m = float(np.mean(mean_c))
    best_m = float(np.mean(best_c))
    worst_m = float(np.mean(worst_c))
    gap = best_m - mean_m

    sel = SelectionMetrics(
        n_groups=n,
        n_tests=len(evaluated_tests),
        top1_accuracy=hits / n,
        # The honest baseline is not 0.5: it is picking at random from however
        # many arms the test had.
        top1_baseline_random=float(np.mean([1.0 / a for a in n_arms])),
        mean_arms_per_group=float(np.mean(n_arms)),
    )
    lift = LiftMetrics(
        n_groups=n,
        ctr_model_choice=chosen_m,
        ctr_mean_arm=mean_m,
        ctr_best_arm=best_m,
        ctr_worst_arm=worst_m,
        lift_vs_mean_pct=100.0 * (chosen_m - mean_m) / mean_m if mean_m else float("nan"),
        lift_vs_worst_pct=100.0 * (chosen_m - worst_m) / worst_m if worst_m else float("nan"),
        # How much of the achievable headroom the model actually captures.
        # 0% == no better than a coin flip; 100% == picks the true winner every time.
        pct_of_oracle_gap_captured=100.0 * (chosen_m - mean_m) / gap if gap else float("nan"),
    )
    return {"selection": asdict(sel), "lift": asdict(lift)}


def calibration(y_true: np.ndarray, p: np.ndarray, n_bins: int = 10) -> Dict:
    """Reliability curve + Brier. The confidence shown in the UI is only honest
    if these probabilities mean what they say."""
    y_true = np.asarray(y_true).astype(int).reshape(-1)
    p = np.asarray(p, dtype=np.float64).reshape(-1)
    frac_pos, mean_pred = calibration_curve(y_true, p, n_bins=n_bins, strategy="quantile")
    counts, edges = np.histogram(p, bins=n_bins, range=(0.0, 1.0))
    max_gap = float(np.max(np.abs(frac_pos - mean_pred))) if len(frac_pos) else float("nan")
    return {
        "brier": float(brier_score_loss(y_true, p)),
        "bin_mean_predicted": [float(x) for x in mean_pred],
        "bin_observed_fraction": [float(x) for x in frac_pos],
        "bin_counts": [int(c) for c in counts],
        "bin_edges": [float(e) for e in edges],
        "max_calibration_gap": max_gap,
    }


def full_report(prob: Callable[[np.ndarray], np.ndarray],
                X: np.ndarray, y: np.ndarray,
                arms: pd.DataFrame, test_ids: Sequence,
                probe_texts: Sequence[str]) -> Dict:
    p = np.asarray(prob(X), dtype=np.float64).reshape(-1)
    out = {
        "pairwise": asdict(pairwise_metrics(y, p)),
        "calibration": calibration(y, p),
        "antisymmetry_max_violation": antisymmetry_violation(prob, probe_texts),
    }
    out.update(selection_and_lift(prob, arms, test_ids))
    return out
