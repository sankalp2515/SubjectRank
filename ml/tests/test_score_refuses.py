"""The scoring script must refuse to serve when it cannot know its inputs.

`azure/ml/score.py` runs on the managed online endpoint. It loads whatever model
directory Azure ML mounts, and the graph it finds takes the REDUCED feature set —
the model's own `feature_names`, in the model's own order.

The bug these tests exist for: `score.py` used to fall back to the extractor's
full feature list when no meta was present, and its feature-spec guard was
written `if _meta and ...`, so a missing meta ALSO skipped the one check whose
job is refusing a mismatched extractor.

On the real endpoint that surfaced as `Got invalid dimensions for input`, which
is the lucky outcome. Had the widths happened to agree — a future spec where the
excluded-feature count is zero, say — it would have served confidently wrong
rankings with no error at all.

A fallback that guesses is worse than a missing file, because the missing file
is loud.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def _load_score():
    """Import score.py by path — it is not part of the installed package."""
    sys.path.insert(0, str(ROOT / "ml"))
    spec = importlib.util.spec_from_file_location(
        "sr_score", ROOT / "azure" / "ml" / "score.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_refuses_when_meta_is_missing(tmp_path, monkeypatch):
    """A graph with no meta is a graph whose inputs are unknown."""
    (tmp_path / "champion.onnx").write_bytes(b"not a real graph")
    monkeypatch.setenv("AZUREML_MODEL_DIR", str(tmp_path))

    score = _load_score()
    with pytest.raises(RuntimeError) as e:
        score.init()

    msg = str(e.value)
    assert "meta.json" in msg, msg
    # It must name the fix, not just complain.
    assert "director" in msg.lower() or "register" in msg.lower(), msg


def test_refuses_when_meta_has_no_feature_names(tmp_path, monkeypatch):
    """Meta present but useless is still not enough to know the column order."""
    (tmp_path / "champion.onnx").write_bytes(b"not a real graph")
    (tmp_path / "champion.meta.json").write_text(json.dumps({
        "feature_spec_version": 1,
        "version": "test",
    }), encoding="utf-8")
    monkeypatch.setenv("AZUREML_MODEL_DIR", str(tmp_path))

    score = _load_score()
    with pytest.raises(RuntimeError) as e:
        score.init()
    assert "feature_names" in str(e.value)


def test_refuses_on_feature_spec_mismatch(tmp_path, monkeypatch):
    """The guard must run whether or not the meta is complete.

    Previously this check was skipped entirely when meta was absent, so the
    protection was weakest in exactly the case where least was known.
    """
    (tmp_path / "champion.onnx").write_bytes(b"not a real graph")
    (tmp_path / "champion.meta.json").write_text(json.dumps({
        "feature_spec_version": 999,
        "feature_names": ["char_count"],
    }), encoding="utf-8")
    monkeypatch.setenv("AZUREML_MODEL_DIR", str(tmp_path))

    score = _load_score()
    with pytest.raises(RuntimeError) as e:
        score.init()
    assert "spec" in str(e.value).lower()
