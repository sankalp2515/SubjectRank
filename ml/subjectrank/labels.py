"""Label pairs, and drop the ones the data cannot actually distinguish. D-010."""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats

from .config import CONFIG, Config
from .data import Ledger


def two_proportion_z(clicks_a, n_a, clicks_b, n_b):
    """Vectorised pooled two-proportion z-test. Returns (z, two-sided p).

    Pooled rather than unpooled because the null is that both arms share one rate,
    which is exactly the hypothesis a randomised A/B test is set up to reject.
    """
    ca = np.asarray(clicks_a, dtype=np.float64)
    na = np.asarray(n_a, dtype=np.float64)
    cb = np.asarray(clicks_b, dtype=np.float64)
    nb = np.asarray(n_b, dtype=np.float64)

    pa, pb = ca / na, cb / nb
    p_pool = (ca + cb) / (na + nb)
    se = np.sqrt(p_pool * (1.0 - p_pool) * (1.0 / na + 1.0 / nb))

    with np.errstate(divide="ignore", invalid="ignore"):
        z = np.where(se > 0, (pa - pb) / se, 0.0)
    p = 2.0 * (1.0 - stats.norm.cdf(np.abs(z)))
    return z, p


def label_pairs(pairs: pd.DataFrame, cfg: Config = CONFIG,
                alpha: Optional[float] = None,
                ledger: Optional[Ledger] = None) -> pd.DataFrame:
    """Attach z, p and the binary label; drop indistinguishable pairs.

    Dropping rather than labelling-by-sign is the point. Many archive arms have
    small exposure, where the observed ordering is mostly noise; labelling those
    teaches the model to predict coin flips and drags every reported metric toward
    0.5 in a way that hides whether the features work at all.
    """
    alpha = cfg.z_test_alpha if alpha is None else alpha
    led = ledger if ledger is not None else pairs.attrs.get("ledger", Ledger())
    out = pairs.copy()

    z, p = two_proportion_z(out["clicks_a"], out["impressions_a"],
                            out["clicks_b"], out["impressions_b"])
    out["z"] = z
    out["p_value"] = p
    out["label"] = (out["ctr_a"] > out["ctr_b"]).astype(np.int8)

    ties = int((out["ctr_a"] == out["ctr_b"]).sum())
    out = out[out["ctr_a"] != out["ctr_b"]]
    led.record("non-tied CTR", len(out), f"dropped {ties:,} exact CTR ties")

    kept = out[out["p_value"] < alpha].copy()
    led.record(f"distinguishable at alpha={alpha}", len(kept),
               f"two-proportion z-test; dropped {len(out) - len(kept):,} as noise")

    kept.attrs["ledger"] = led
    kept.attrs["alpha"] = alpha
    return kept.reset_index(drop=True)


def alpha_sweep(pairs: pd.DataFrame, cfg: Config = CONFIG) -> pd.DataFrame:
    """How many pairs survive at each threshold, and how balanced they are.

    Exists so the threshold in D-010 is a reported choice with a table behind it
    rather than a number someone picked once.
    """
    z, p = two_proportion_z(pairs["clicks_a"], pairs["impressions_a"],
                            pairs["clicks_b"], pairs["impressions_b"])
    label = (pairs["ctr_a"] > pairs["ctr_b"]).astype(int)
    non_tied = pairs["ctr_a"] != pairs["ctr_b"]
    rows = []
    for a in cfg.z_alpha_sweep:
        m = non_tied & (p < a)
        n = int(m.sum())
        rows.append({
            "alpha": a,
            "pairs": n,
            "pct_of_candidates": round(100.0 * n / max(len(pairs), 1), 2),
            "label_balance": round(float(label[m].mean()), 4) if n else float("nan"),
            "median_min_impressions": (
                float(np.minimum(pairs["impressions_a"][m],
                                 pairs["impressions_b"][m]).median()) if n else float("nan")),
        })
    return pd.DataFrame(rows)
