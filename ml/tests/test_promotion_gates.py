"""The promotion gates, tested where both promotion paths can see them.

`ml/scripts/promote_model.py` (local) and `azure/ml/promote.py` (registry) share
`subjectrank.promotion.check`. If these tests pass, the two paths cannot disagree
about what is shippable — which is the whole reason the module exists.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from subjectrank.promotion import check  # noqa: E402

SPEC = 1


def good(**over):
    m = {
        "feature_spec_version": SPEC,
        "antisymmetry_max_violation": 2.98e-08,
        "antisymmetry_tolerance": 1e-6,
        "onnx_export": {"passed": True},
    }
    m.update(over)
    return m


def test_the_promoted_champion_passes():
    assert check(good(), SPEC).passed


def test_synthetic_is_refused():
    assert not check(good(SYNTHETIC=True), SPEC).passed


def test_synthetic_cannot_be_forced():
    """The one gate with no override.

    A synthetic artifact exists so the serving path can be exercised on a machine
    with no data. Promoting one puts fabricated rankings in front of people, which
    is the single thing this project exists to argue against, so --force must not
    reach it.
    """
    g = check(good(SYNTHETIC=True), SPEC, force="I know what I am doing")
    assert not g.passed
    assert any("SYNTHETIC" in f for f in g.failures)


def test_feature_spec_mismatch_is_refused_and_not_forceable():
    g = check(good(feature_spec_version=SPEC + 1), SPEC, force="ship it")
    assert not g.passed


def test_failed_onnx_export_is_refused():
    """D-026: candidate_lgbm's real failure mode."""
    g = check(good(onnx_export={"passed": False, "max_abs_delta": 2.84e-2,
                                "tolerance": 1e-5}), SPEC)
    assert not g.passed
    assert any("does not reproduce" in f for f in g.failures)


def test_antisymmetry_violation_is_refused_by_default():
    g = check(good(antisymmetry_max_violation=1.349e-01), SPEC)
    assert not g.passed


def test_antisymmetry_violation_is_forceable_and_the_reason_is_kept():
    """D-013 is a product tradeoff, not an impossibility, so it has an override --
    but the override has to leave a trace."""
    g = check(good(antisymmetry_max_violation=1.349e-01), SPEC,
              force="benchmark only, never user-facing")
    assert g.passed
    assert g.warnings
    assert g.forced == "benchmark only, never user-facing"


def test_a_missing_antisymmetry_number_does_not_silently_pass_as_zero():
    """Absent is not the same as zero. A meta with no measurement should not be
    treated as though the measurement came back clean."""
    m = good()
    del m["antisymmetry_max_violation"]
    g = check(m, SPEC)
    # It passes -- there is nothing to fail on -- but the export gate and the
    # spec gate still apply, so this documents the intended behaviour rather
    # than asserting it is ideal. See the note in promotion.py.
    assert g.passed


@pytest.mark.parametrize("bad", [True, "true", "True"])
def test_synthetic_flag_variants(bad):
    assert not check(good(synthetic=bad), SPEC).passed
