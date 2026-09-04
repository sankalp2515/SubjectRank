"""Champion/challenger promotion.

A challenger is promoted only if it wins on BOTH the frozen Upworthy holdout and
the user-reported labels. Winning on one is not enough: beating the challenger on
Upworthy alone selects for fitting 2015 harder, and beating it on user labels
alone can be a handful of noisy self-reports.

A challenger that loses and is correctly rejected is worth documenting, and this
module returns the reasoning either way so EXPERIMENTS.md can record it.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Dict, Optional

import numpy as np


@dataclass
class Verdict:
    promote: bool
    reason: str
    details: Dict

    def to_dict(self) -> Dict:
        return asdict(self)


def decide(champion: Dict, challenger: Dict,
           min_holdout_gain: float = 0.005,
           min_user_gain: float = 0.0,
           min_user_labels: int = 200,
           antisymmetry_tolerance: float = 1e-6) -> Verdict:
    """Both-or-nothing promotion.

    `champion` and `challenger` are metric dicts of the shape
    {"holdout_accuracy", "user_accuracy", "n_user_labels", "antisymmetry"}.
    """
    d: Dict = {"champion": champion, "challenger": challenger,
               "thresholds": {"min_holdout_gain": min_holdout_gain,
                              "min_user_gain": min_user_gain,
                              "min_user_labels": min_user_labels}}

    # Gate 0: correctness before performance. A model whose ranking depends on
    # input order is not a candidate however accurate it is (D-013).
    anti = challenger.get("antisymmetry")
    if anti is not None and anti > antisymmetry_tolerance:
        return Verdict(False,
                       f"REJECTED: challenger antisymmetry violation {anti:.2e} exceeds "
                       f"{antisymmetry_tolerance:.1e}. Reordering a user's inputs could "
                       f"change the winner. Correctness gates accuracy.", d)

    n_user = challenger.get("n_user_labels", 0)
    if n_user < min_user_labels:
        return Verdict(False,
                       f"HELD: only {n_user} user-reported labels, need "
                       f"{min_user_labels}. Promoting on the Upworthy holdout alone "
                       f"would select for fitting 2015 harder, which is the opposite "
                       f"of what the retraining loop is for.", d)

    h_gain = challenger["holdout_accuracy"] - champion["holdout_accuracy"]
    u_gain = challenger["user_accuracy"] - champion["user_accuracy"]
    d["holdout_gain"] = h_gain
    d["user_gain"] = u_gain

    wins_holdout = h_gain >= min_holdout_gain
    wins_user = u_gain > min_user_gain

    if wins_holdout and wins_user:
        return Verdict(True,
                       f"PROMOTE: holdout {h_gain:+.4f} and user-reported {u_gain:+.4f}. "
                       f"Wins on both.", d)

    if wins_holdout and not wins_user:
        return Verdict(False,
                       f"REJECTED: holdout {h_gain:+.4f} but user-reported {u_gain:+.4f}. "
                       f"Better on 2015, no better on the domain we actually serve. "
                       f"This is the case the both-gates rule exists for.", d)

    if wins_user and not wins_holdout:
        return Verdict(False,
                       f"REJECTED: user-reported {u_gain:+.4f} but holdout {h_gain:+.4f}. "
                       f"A gain on {n_user} self-reported outcomes without a holdout "
                       f"gain is more likely noise than learning.", d)

    return Verdict(False,
                   f"REJECTED: worse on both (holdout {h_gain:+.4f}, "
                   f"user {u_gain:+.4f}). Champion stands.", d)
