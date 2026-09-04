"""Turn a pairwise model into a ranking over an arbitrary set of lines.

This is the piece the product actually calls: the user gives 2-5 subject lines,
we score every ordered pair and aggregate. Kept separate from evaluation so that
the exact code path used in the app is the one that gets measured.
"""
from __future__ import annotations

from typing import Callable, Dict, List, Sequence

import numpy as np

from .features import extract


def pairwise_matrix(prob: Callable[[np.ndarray], np.ndarray],
                    texts: Sequence[str]) -> np.ndarray:
    """P[i, j] = probability line i beats line j. Diagonal is 0.5 by definition."""
    n = len(texts)
    F = np.asarray([extract(t) for t in texts], dtype=np.float64)
    P = np.full((n, n), 0.5, dtype=np.float64)
    if n < 2:
        return P
    idx = [(i, j) for i in range(n) for j in range(n) if i != j]
    D = np.asarray([F[i] - F[j] for i, j in idx], dtype=np.float64)
    p = np.asarray(prob(D), dtype=np.float64).reshape(-1)
    for (i, j), v in zip(idx, p):
        P[i, j] = v
    return P


def rank(prob: Callable[[np.ndarray], np.ndarray],
         texts: Sequence[str]) -> Dict:
    """Rank lines best-first.

    Aggregation is the mean win probability against the other supplied lines --
    a Borda count on probabilities. Chosen over a tournament or Bradley-Terry fit
    because with 2-5 items it is exact enough, is order-independent, and is
    explainable to a user in one sentence: "how often we think it wins against the
    others you gave us."
    """
    n = len(texts)
    P = pairwise_matrix(prob, texts)
    if n < 2:
        return {"order": list(range(n)),
                "scores": [0.5] * n,
                "pairwise": P.tolist(),
                "confidence": [0.0] * n}

    off = ~np.eye(n, dtype=bool)
    scores = np.array([P[i][off[i]].mean() for i in range(n)])
    order = list(np.argsort(-scores, kind="mergesort"))

    # Confidence for the comparison, not for the line: how far from a coin flip
    # the winner's pairwise probabilities actually are. Never shown as a bare
    # number (friction point 1 in the brief).
    conf = np.array([np.abs(P[i][off[i]] - 0.5).mean() * 2.0 for i in range(n)])
    return {"order": [int(i) for i in order],
            "scores": [float(s) for s in scores],
            "pairwise": P.tolist(),
            "confidence": [float(c) for c in conf]}


def antisymmetry_violation(prob: Callable[[np.ndarray], np.ndarray],
                           texts: Sequence[str]) -> float:
    """max |f(d) + f(-d) - 1| over all pairs from `texts`. D-009.

    If this is not near zero, reordering the inputs can change the ranking, which
    is the single most obviously broken thing this product could do.
    """
    F = np.asarray([extract(t) for t in texts], dtype=np.float64)
    n = len(texts)
    pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]
    if not pairs:
        return 0.0
    D = np.asarray([F[i] - F[j] for i, j in pairs])
    fwd = np.asarray(prob(D)).reshape(-1)
    rev = np.asarray(prob(-D)).reshape(-1)
    return float(np.max(np.abs(fwd + rev - 1.0)))
