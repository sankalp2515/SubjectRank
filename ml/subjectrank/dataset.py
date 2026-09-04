"""Turn labelled pairs into the antisymmetric difference matrix the model trains on."""
from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

from .config import BANNED_AS_FEATURES, CONFIG, Config
from .features import extract, feature_names


def assert_features_are_clean(names: List[str]) -> None:
    """D-004, enforced rather than intended."""
    for banned in BANNED_AS_FEATURES:
        for n in names:
            if banned in n:
                raise RuntimeError(
                    f"feature {n!r} references banned column {banned!r}. See D-004 -- "
                    f"impressions in particular encode the outcome and the stopping "
                    f"decision, and a model given them will look excellent while "
                    f"having learned nothing about headlines."
                )


def headline_matrix(texts) -> np.ndarray:
    uniq = {}
    for t in texts:
        if t not in uniq:
            uniq[t] = extract(t)
    return np.asarray([uniq[t] for t in texts], dtype=np.float64)


def build_xy(pairs: pd.DataFrame, cfg: Config = CONFIG, augment: bool = True
             ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, List[str]]:
    """Return (X, y, groups, feature_names).

    X is the difference vector x_A - x_B. When augment=True every pair is emitted
    in BOTH directions, which is how antisymmetry gets into the model (D-009):
    nothing in logistic regression or a tree ensemble guarantees
    f(d) + f(-d) == 1, and a user reordering their inputs must not change the
    ranking.
    """
    names = feature_names()
    assert_features_are_clean(names)

    fa = headline_matrix(pairs["headline_a"].tolist())
    fb = headline_matrix(pairs["headline_b"].tolist())
    d = fa - fb
    y = pairs["label"].values.astype(np.int8)
    g = pairs["test_id"].values

    if not augment:
        return d, y, g, names

    X = np.vstack([d, -d])
    Y = np.concatenate([y, 1 - y]).astype(np.int8)
    G = np.concatenate([g, g])
    return X, Y, G, names


def feature_support(X: np.ndarray, names: List[str]) -> pd.DataFrame:
    """Fraction of pairs where each feature's difference is non-zero.

    D-012: emoji are near-absent from 2013-2015 headlines. A coefficient fitted on
    a handful of pairs is not knowledge, and the UI must not attribute anything to
    a feature the model effectively never saw.
    """
    nz = (np.abs(X) > 0).mean(axis=0)
    return (pd.DataFrame({"feature": names, "support": nz})
              .sort_values("support", kind="mergesort")
              .reset_index(drop=True))
