"""Export a fitted pairwise model to ONNX and prove the export is faithful.

Serving runs onnxruntime-node inside a Vercel function. An ONNX graph that
disagrees with the Python model it came from is a second training/serving skew on
top of the feature one, so the export is not considered done until verified
element-wise on the frozen parity corpus.
"""
from __future__ import annotations

import json
import pathlib
from typing import Dict, List, Optional, Sequence

import numpy as np

from .config import ARTIFACTS, CONFIG, Config
from .features import extract, feature_names


def _to_onnx(model, n_features: int):
    """Convert to ONNX, using each converter's OWN tensor type.

    onnxmltools and skl2onnx each define a FloatTensorType and they are not
    interchangeable -- onnxmltools rejects skl2onnx's class by identity, not by
    structure. Passing the wrong one fails at shape inference with a message that
    does not obviously say "wrong import".
    """
    if type(model).__name__ == "LGBMClassifier":
        from onnxmltools.convert import convert_lightgbm
        from onnxmltools.convert.common.data_types import (
            FloatTensorType as MlToolsFloatTensorType)
        return convert_lightgbm(
            model,
            initial_types=[("input", MlToolsFloatTensorType([None, n_features]))],
            zipmap=False, target_opset=15)

    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType
    return convert_sklearn(
        model,
        initial_types=[("input", FloatTensorType([None, n_features]))],
        options={id(model): {"zipmap": False}},
        target_opset=15)


def _onnx_prob(sess, D: np.ndarray) -> np.ndarray:
    D = np.asarray(D, dtype=np.float32)
    if D.ndim == 1:
        D = D.reshape(1, -1)
    outs = sess.run(None, {sess.get_inputs()[0].name: D})
    for o in outs:
        a = np.asarray(o)
        if a.ndim == 2 and a.shape[1] == 2:
            return a[:, 1].astype(np.float64)
    raise RuntimeError(f"no probability output found; shapes {[np.shape(o) for o in outs]}")


def export_and_verify(model, keep_idx: Sequence[int], kept_names: List[str],
                      out_path: pathlib.Path, corpus_texts: Sequence[str],
                      cfg: Config = CONFIG, metadata: Optional[Dict] = None,
                      raise_on_fail: bool = True) -> Dict:
    """Write the ONNX file and assert it reproduces the Python model.

    Verification uses difference vectors built from the frozen parity corpus, so
    the comparison covers the same adversarial Unicode and emoji cases the feature
    extractors are tested on, not just well-behaved input.
    """
    import onnx
    import onnxruntime as ort

    n = len(kept_idx := list(keep_idx))
    onx = _to_onnx(model, n)

    meta = {"feature_spec_version": "1", "n_features": str(n),
            "feature_names": json.dumps(kept_names)}
    meta.update({k: str(v) for k, v in (metadata or {}).items()})
    for k, v in meta.items():
        e = onx.metadata_props.add()
        e.key, e.value = k, v

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(onx.SerializeToString())
    onnx.checker.check_model(onnx.load(str(out_path)))

    # Build difference vectors from consecutive corpus entries: adversarial input,
    # and every one of them a shape the server will actually see.
    F = np.asarray([extract(t) for t in corpus_texts], dtype=np.float64)[:, kept_idx]
    Dm = np.vstack([F[:-1] - F[1:], F[1:] - F[:-1], np.zeros((1, n))])

    py = model.predict_proba(Dm)[:, 1]
    sess = onnx_session(out_path)
    on = _onnx_prob(sess, Dm)

    delta = np.abs(py - on)
    worst = float(delta.max())
    ok = worst <= cfg.onnx_parity_tolerance
    # How the error is DISTRIBUTED separates two very different faults. A uniform
    # ~1e-7 everywhere is the expected float32/float64 residual. A few vectors
    # off by a lot, with the rest exact, is a split-threshold flip: the converter
    # rounded a tree's threshold to float32 and some samples now take the other
    # branch. The second kind does not shrink with a looser tolerance -- it means
    # the graph is a different function from the model.
    over = int((delta > cfg.onnx_parity_tolerance).sum())

    # Antisymmetry measured on the EXPORTED graph, not on the Python model
    # (D-009). This is the property a user experiences directly: if it is not
    # near zero, reordering the lines they pasted can change which one wins.
    half = (len(Dm) - 1) // 2
    fwd, rev = on[:half], on[half:2 * half]
    antisym = float(np.max(np.abs(fwd + rev - 1.0))) if half else 0.0

    result = {
        "path": str(out_path),
        "bytes": out_path.stat().st_size,
        "n_features": n,
        "n_vectors_checked": int(len(Dm)),
        "max_abs_delta": worst,
        "mean_abs_delta": float(delta.mean()),
        "median_abs_delta": float(np.median(delta)),
        "n_vectors_over_tolerance": over,
        "pct_vectors_over_tolerance": round(100.0 * over / len(delta), 4),
        "tolerance": cfg.onnx_parity_tolerance,
        "passed": bool(ok),
        "antisymmetry_max_violation": antisym,
        # float32 in the graph vs float64 in Python is the expected source of any
        # residual difference; anything beyond tolerance is a conversion bug.
        "note": "ONNX runs float32; Python runs float64. Residual delta at ~1e-7 is expected.",
    }
    if not ok:
        msg = (f"ONNX export does NOT reproduce the Python model: max delta "
               f"{worst:.3e} > tolerance {cfg.onnx_parity_tolerance:.1e} "
               f"({over} of {len(delta)} vectors over tolerance, median delta "
               f"{np.median(delta):.3e}). Do not deploy this graph.")
        result["failure"] = msg
        if raise_on_fail:
            raise RuntimeError(msg)
        # The caller has opted to record the failure instead of aborting. Remove
        # the graph so a rejected export cannot be mistaken for a promotable one.
        out_path.unlink(missing_ok=True)
        return result
    if antisym > cfg.antisymmetry_tolerance:
        result["antisymmetry_warning"] = (
            f"f(d)+f(-d) deviates from 1 by up to {antisym:.3e}, above the "
            f"{cfg.antisymmetry_tolerance:.1e} tolerance. Reordering a user's inputs "
            f"can change a close ranking. Expected for tree ensembles; must be "
            f"reported in MODEL_CARD.md and weighed against any accuracy gain."
        )
    return result


def onnx_session(path: pathlib.Path):
    import onnxruntime as ort
    so = ort.SessionOptions()
    # Silences a cosmetic VerifyOutputSizes warning about the unused `label`
    # output's declared shape. The probability output is unaffected; verified by
    # export_and_verify comparing against the Python model element-wise.
    so.log_severity_level = 3
    return ort.InferenceSession(str(path), sess_options=so,
                                providers=["CPUExecutionProvider"])


def onnx_prob_fn(path: pathlib.Path, keep_idx: Sequence[int]):
    sess = onnx_session(path)
    idx = list(keep_idx)

    def f(Dm: np.ndarray) -> np.ndarray:
        Dm = np.asarray(Dm, dtype=np.float64)
        if Dm.ndim == 1:
            Dm = Dm.reshape(1, -1)
        return _onnx_prob(sess, Dm[:, idx] if Dm.shape[1] != len(idx) else Dm)
    return f
