import pathlib
import sys

import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from subjectrank.drift import (compare, population_stability_index,  # noqa: E402
                               prediction_health, psi_band, summarise)
from subjectrank.retrain import decide  # noqa: E402


def test_psi_is_near_zero_for_identical_distributions():
    rs = np.random.RandomState(0)
    a, b = rs.normal(size=5000), rs.normal(size=5000)
    assert population_stability_index(a, b) < 0.1
    assert psi_band(population_stability_index(a, b)) == "stable"


def test_psi_detects_a_real_shift():
    rs = np.random.RandomState(0)
    train, live = rs.normal(0, 1, 5000), rs.normal(2.5, 1, 5000)
    psi = population_stability_index(train, live)
    assert psi > 0.25
    assert psi_band(psi) == "major shift"


def test_psi_is_asymmetric_in_the_safe_direction():
    """Bins come from train, so live mass outside the training range shows up."""
    rs = np.random.RandomState(1)
    train = rs.uniform(0, 1, 3000)
    live = rs.uniform(5, 6, 3000)
    assert population_stability_index(train, live) > 1.0


def test_compare_ranks_the_worst_feature_first():
    rs = np.random.RandomState(2)
    names = ["stable_a", "stable_b", "shifted"]
    train = np.column_stack([rs.normal(size=3000), rs.normal(size=3000),
                             rs.normal(size=3000)])
    live = np.column_stack([rs.normal(size=3000), rs.normal(size=3000),
                            rs.normal(4, 1, size=3000)])
    drifts = compare(train, live, names)
    assert drifts[0].feature == "shifted"
    s = summarise(drifts)
    assert "shifted" in s["flagged_features"]
    assert s["n_flagged"] == 1


def test_prediction_health_flags_a_degenerate_model():
    rs = np.random.RandomState(3)
    healthy = rs.beta(2, 2, 4000)
    degenerate = 0.5 + rs.normal(0, 0.005, 4000)
    assert prediction_health(healthy)["degenerate"] is False
    assert prediction_health(degenerate)["degenerate"] is True


def test_promotion_requires_winning_on_both():
    champ = {"holdout_accuracy": 0.62, "user_accuracy": 0.58}
    both = {"holdout_accuracy": 0.64, "user_accuracy": 0.61,
            "n_user_labels": 500, "antisymmetry": 1e-9}
    assert decide(champ, both).promote is True


def test_holdout_only_win_is_rejected():
    champ = {"holdout_accuracy": 0.62, "user_accuracy": 0.58}
    ch = {"holdout_accuracy": 0.66, "user_accuracy": 0.57,
          "n_user_labels": 500, "antisymmetry": 1e-9}
    v = decide(champ, ch)
    assert v.promote is False
    assert "no better on the domain we actually serve" in v.reason


def test_user_only_win_is_rejected():
    champ = {"holdout_accuracy": 0.62, "user_accuracy": 0.58}
    ch = {"holdout_accuracy": 0.615, "user_accuracy": 0.63,
          "n_user_labels": 500, "antisymmetry": 1e-9}
    v = decide(champ, ch)
    assert v.promote is False
    assert "more likely noise" in v.reason


def test_insufficient_user_labels_holds():
    champ = {"holdout_accuracy": 0.62, "user_accuracy": 0.58}
    ch = {"holdout_accuracy": 0.70, "user_accuracy": 0.70,
          "n_user_labels": 12, "antisymmetry": 1e-9}
    v = decide(champ, ch)
    assert v.promote is False
    assert "HELD" in v.reason


def test_antisymmetry_gates_before_accuracy():
    """A model whose ranking depends on paste order is not a candidate. D-013."""
    champ = {"holdout_accuracy": 0.62, "user_accuracy": 0.58}
    ch = {"holdout_accuracy": 0.80, "user_accuracy": 0.80,
          "n_user_labels": 5000, "antisymmetry": 3.3e-2}
    v = decide(champ, ch)
    assert v.promote is False
    assert "Correctness gates accuracy" in v.reason
