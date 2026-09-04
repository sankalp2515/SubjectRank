"""Population Stability Index and Kolmogorov-Smirnov, per feature.

Compares the live distribution of extracted features against the training
distribution.

Expect this to fire immediately and dramatically. 2026 email subject lines are
shorter, carry more emoji and punctuation, and use less curiosity-gap phrasing
than 2013-2015 Upworthy headlines. That is the finding this project is partly
about (D-011, Q-003), not an incident to suppress.

What would actually be alarming is in RUNBOOK.md section 5.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

import numpy as np
from scipy import stats

# Conventional PSI reading. Stated here so the dashboard's colours are traceable
# to something rather than chosen to look calm.
PSI_BANDS = ((0.10, "stable"), (0.25, "moderate shift"), (float("inf"), "major shift"))


def psi_band(psi: float) -> str:
    for threshold, label in PSI_BANDS:
        if psi < threshold:
            return label
    return "major shift"


def population_stability_index(train: np.ndarray, live: np.ndarray,
                               n_bins: int = 10, eps: float = 1e-6) -> float:
    """PSI with quantile bins taken from the TRAINING distribution.

    Binning on train and applying those edges to live is the point: bins derived
    from the combined data would move as live data arrives and would understate
    the shift, which is the direction of error that lets a problem hide.
    """
    train = np.asarray(train, dtype=np.float64)
    train = train[np.isfinite(train)]
    live = np.asarray(live, dtype=np.float64)
    live = live[np.isfinite(live)]
    if len(train) == 0 or len(live) == 0:
        return float("nan")

    edges = np.unique(np.quantile(train, np.linspace(0, 1, n_bins + 1)))
    if len(edges) < 3:
        # A near-constant feature in training. PSI is undefined in any useful
        # sense; report the mass that fell outside the single observed value.
        outside = float(np.mean(live != train[0])) if len(np.unique(train)) == 1 else 0.0
        return outside * 10.0

    edges[0], edges[-1] = -np.inf, np.inf
    t_counts, _ = np.histogram(train, bins=edges)
    l_counts, _ = np.histogram(live, bins=edges)

    t_pct = np.maximum(t_counts / t_counts.sum(), eps)
    l_pct = np.maximum(l_counts / l_counts.sum(), eps)
    return float(np.sum((l_pct - t_pct) * np.log(l_pct / t_pct)))


@dataclass
class FeatureDrift:
    feature: str
    psi: float
    band: str
    ks_statistic: float
    ks_p_value: float
    train_mean: float
    train_std: float
    live_mean: float
    live_std: float
    n_live: int


def compare(train_matrix: np.ndarray, live_matrix: np.ndarray,
            feature_names: Sequence[str], n_bins: int = 10) -> List[FeatureDrift]:
    out: List[FeatureDrift] = []
    for i, name in enumerate(feature_names):
        t = np.asarray(train_matrix[:, i], dtype=np.float64)
        l = np.asarray(live_matrix[:, i], dtype=np.float64)
        psi = population_stability_index(t, l, n_bins=n_bins)
        try:
            ks = stats.ks_2samp(t, l)
            ks_stat, ks_p = float(ks.statistic), float(ks.pvalue)
        except Exception:
            ks_stat, ks_p = float("nan"), float("nan")
        out.append(FeatureDrift(
            feature=name, psi=psi, band=psi_band(psi),
            ks_statistic=ks_stat, ks_p_value=ks_p,
            train_mean=float(t.mean()), train_std=float(t.std()),
            live_mean=float(l.mean()), live_std=float(l.std()),
            n_live=int(len(l)),
        ))
    return sorted(out, key=lambda d: (-d.psi if np.isfinite(d.psi) else 0))


def prediction_health(probs: np.ndarray) -> Dict:
    """Statistics on the predicted pairwise probabilities.

    Input drift is expected. Predictions collapsing toward 0.5 is not: it means
    the model has stopped discriminating, and that IS the alarm.
    """
    p = np.asarray(probs, dtype=np.float64)
    p = p[np.isfinite(p)]
    if len(p) == 0:
        return {"n": 0}
    near_half = float(np.mean(np.abs(p - 0.5) < 0.05))
    return {
        "n": int(len(p)),
        "mean": float(p.mean()),
        "std": float(p.std()),
        "p05": float(np.quantile(p, 0.05)),
        "median": float(np.median(p)),
        "p95": float(np.quantile(p, 0.95)),
        "fraction_within_0.05_of_half": near_half,
        # A model that used to discriminate and now does not is the failure this
        # number exists to surface.
        "degenerate": bool(near_half > 0.80 or p.std() < 0.02),
    }


def summarise(drifts: Sequence[FeatureDrift], psi_threshold: float = 0.25) -> Dict:
    flagged = [d.feature for d in drifts if np.isfinite(d.psi) and d.psi >= psi_threshold]
    finite = [d.psi for d in drifts if np.isfinite(d.psi)]
    return {
        "n_features": len(drifts),
        "flagged_features": flagged,
        "n_flagged": len(flagged),
        "max_psi": float(max(finite)) if finite else float("nan"),
        "psi_threshold": psi_threshold,
        "note": ("Input drift against 2013-2015 Upworthy headlines is EXPECTED and is "
                 "a finding, not an incident. See RUNBOOK.md section 5."),
    }
