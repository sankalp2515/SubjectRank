"""The three models from the mission spec, behind one interface.

Only three. There is no time and no benefit in a fourth, and a sprawl of
half-tuned variants is worse evidence of judgement than a clean comparison of a
baseline, a candidate, and a documented rejection.
"""
from __future__ import annotations

from typing import Callable, Dict, List

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .config import CONFIG, Config


def make_baseline(cfg: Config = CONFIG) -> Pipeline:
    """Logistic regression on hand features.

    This is not a formality. If the gradient-boosted model does not clearly beat
    it, we ship this and say so.

    Two deliberate choices make it *structurally* antisymmetric rather than
    approximately so (D-009):

    - `fit_intercept=False`. On the augmented difference data the intercept would
      fit to ~0 anyway, but forcing it to exactly 0 means f(d) + f(-d) == 1 by
      construction, not by luck.
    - `StandardScaler(with_mean=False)`. Centring would add a constant offset to
      the linear term and break the same guarantee. Scaling by standard deviation
      alone is an odd function and preserves it.

    The result: reordering a user's inputs cannot change the ranking, and that is
    a property of the model rather than of the training data staying balanced.
    """
    return Pipeline([
        ("scale", StandardScaler(with_mean=False)),
        ("clf", LogisticRegression(fit_intercept=False, **cfg.logreg_params)),
    ])


def make_candidate(cfg: Config = CONFIG):
    from lightgbm import LGBMClassifier
    return LGBMClassifier(random_state=cfg.random_state, **cfg.lgbm_params)


def prob_fn(model) -> Callable[[np.ndarray], np.ndarray]:
    """Uniform P(A beats B) callable, so evaluation code never branches on model type."""
    def f(D: np.ndarray) -> np.ndarray:
        D = np.asarray(D, dtype=np.float64)
        if D.ndim == 1:
            D = D.reshape(1, -1)
        return model.predict_proba(D)[:, 1]
    return f
