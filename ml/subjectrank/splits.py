"""Splitting. Both schemes from D-005, and a guard that makes row-splitting hard
to do by accident."""
from __future__ import annotations

from typing import Iterator, Tuple

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from .config import CONFIG, Config


class LeakageError(RuntimeError):
    pass


def assert_no_test_overlap(train: pd.DataFrame, test: pd.DataFrame,
                           col: str = "test_id") -> None:
    """Arms from one Upworthy test share a story, an image, an editor and a day.
    If a test id appears on both sides, every metric downstream is inflated."""
    overlap = set(train[col]) & set(test[col])
    if overlap:
        raise LeakageError(
            f"{len(overlap):,} {col} values appear in BOTH train and test "
            f"(e.g. {sorted(overlap)[:3]}). This is the row-split leak from D-005. "
            f"Every metric computed from this split is meaningless."
        )


def group_folds(pairs: pd.DataFrame, cfg: Config = CONFIG
                ) -> Iterator[Tuple[np.ndarray, np.ndarray]]:
    """GroupKFold on test id, for model selection only."""
    gkf = GroupKFold(n_splits=cfg.n_folds)
    groups = pairs["test_id"].values
    for tr, te in gkf.split(pairs, groups=groups):
        assert_no_test_overlap(pairs.iloc[tr], pairs.iloc[te])
        yield tr, te


def temporal_split(pairs: pd.DataFrame, cfg: Config = CONFIG
                   ) -> Tuple[np.ndarray, np.ndarray, pd.Timestamp]:
    """Date-based holdout on the most recent tests. The honest final number.

    Cut by TEST, not by pair: a test's pairs all share a date, and splitting
    within a test would reintroduce the group leak through the back door.
    """
    if pairs["created_at"].isna().all():
        raise LeakageError(
            "created_at is entirely null, so no temporal holdout is possible. "
            "Report the group-split number only, and say why -- do not silently "
            "substitute a random split and call it temporal."
        )
    per_test = (pairs.groupby("test_id")["created_at"].min()
                     .sort_values(kind="mergesort"))
    n_hold = max(1, int(round(len(per_test) * cfg.temporal_holdout_frac)))
    holdout_tests = set(per_test.index[-n_hold:])
    cutoff = per_test.iloc[-n_hold]

    is_hold = pairs["test_id"].isin(holdout_tests).values
    tr = np.where(~is_hold)[0]
    te = np.where(is_hold)[0]
    assert_no_test_overlap(pairs.iloc[tr], pairs.iloc[te])
    return tr, te, cutoff
