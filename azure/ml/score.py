"""Scoring script for the Azure ML managed online endpoint.

**This endpoint is not how the product serves traffic.** D-006 chose in-process
ONNX in a Node function over a Python inference service, and that choice was
reasoned rather than measured. This exists so it can be measured — see D-031 and
`azure/bench/`. It is stood up for the benchmark and torn down afterwards.

One thing here is a genuine finding rather than plumbing: **this file cannot
import the TypeScript feature extractor**, so it uses the Python one. That is
exactly the training/serving skew the parity suite exists to police, and it means
an endpoint-based architecture would need the parity suite to cover a third
implementation boundary — Python-training vs Python-serving vs TypeScript-client
— instead of the two it covers today. That cost does not show up in a latency
number, and it belongs in the decision.

Input:   {"lines": ["...", "..."]}
Output:  the same shape web/src/lib/model.ts returns, minus attribution.
"""
from __future__ import annotations

import json
import logging
import os
import pathlib
import sys
import time

import numpy as np

_log = logging.getLogger("subjectrank")
_session = None
_meta: dict = {}
_keep_idx: list[int] = []


def init() -> None:
    global _session, _meta, _keep_idx

    root = pathlib.Path(os.environ["AZUREML_MODEL_DIR"])
    onnx_files = list(root.rglob("*.onnx"))
    if len(onnx_files) != 1:
        raise RuntimeError(f"expected one .onnx under {root}, found {onnx_files}")

    # The repo is shipped alongside the model so the SAME feature extractor runs
    # here as in training. Anything else would be a second skew surface.
    code = pathlib.Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(code / "ml"))

    from subjectrank.features import FEATURE_SPEC_VERSION, feature_names  # noqa: PLC0415

    meta_files = list(root.rglob("champion.meta.json")) or list(root.rglob("*.meta.json"))
    _meta.update(json.loads(meta_files[0].read_text(encoding="utf-8")) if meta_files else {})

    if _meta and _meta.get("feature_spec_version") != FEATURE_SPEC_VERSION:
        raise RuntimeError(
            f"model is spec v{_meta.get('feature_spec_version')}, extractor is "
            f"v{FEATURE_SPEC_VERSION}. Refusing to serve."
        )

    names = feature_names()
    wanted = _meta.get("feature_names") or names
    _keep_idx = [names.index(n) for n in wanted]

    import onnxruntime as ort  # noqa: PLC0415
    so = ort.SessionOptions()
    so.log_severity_level = 3
    _session = ort.InferenceSession(str(onnx_files[0]), sess_options=so,
                                    providers=["CPUExecutionProvider"])
    _log.info("loaded %s (%d features)", _meta.get("version"), len(_keep_idx))


def _prob(diffs: np.ndarray) -> np.ndarray:
    out = _session.run(None, {_session.get_inputs()[0].name:
                              np.asarray(diffs, dtype=np.float32)})
    for o in out:
        arr = np.asarray(o)
        if arr.ndim == 2 and arr.shape[1] == 2:
            return arr[:, 1].astype(np.float64)
    raise RuntimeError("no probability output in the graph")


def run(raw_data):
    t0 = time.perf_counter()
    from subjectrank.features import extract, normalise  # noqa: PLC0415

    body = json.loads(raw_data) if isinstance(raw_data, (str, bytes)) else raw_data
    lines = [s for s in (body or {}).get("lines", []) if isinstance(s, str) and s.strip()]
    if len(lines) < 2:
        return {"error": "Give at least two lines — this compares them against each other."}
    if len(lines) > 5:
        return {"error": "That's more than 5 lines. Drop a few and compare again."}

    normalised = [normalise(s) for s in lines]
    full = np.asarray([extract(s) for s in normalised], dtype=np.float64)
    reduced = full[:, _keep_idx]

    n = len(lines)
    pairs = [(i, j) for i in range(n) for j in range(n) if i != j]
    probs = _prob(np.asarray([reduced[i] - reduced[j] for i, j in pairs]))

    P = np.full((n, n), 0.5)
    for (i, j), p in zip(pairs, probs):
        P[i, j] = p
    off = ~np.eye(n, dtype=bool)
    scores = np.array([P[i][off[i]].mean() for i in range(n)])
    order = np.argsort(-scores, kind="mergesort")

    return {
        "modelVersion": _meta.get("version"),
        "lines": [
            {"index": int(i), "rank": int(r + 1), "score": float(scores[i]),
             "text": lines[i], "normalisedText": normalised[i]}
            for r, i in enumerate(order)
        ],
        "inferenceMs": round((time.perf_counter() - t0) * 1000, 3),
    }
