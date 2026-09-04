"""Export the fitted models to ONNX and write the metadata the server reads.

The missing link. `subjectrank.export_onnx.export_and_verify` existed and was
covered by the smoke test, but nothing in the training path called it, so
`promote_model.py` had no `ml/artifacts/*.onnx` to promote. This script closes
that gap: train, export both models, verify each graph against its Python twin,
and record the D-013 antisymmetry violation **measured on the exported graph**.

It writes, per model:
  ml/artifacts/<model>.onnx
  ml/artifacts/<model>.meta.json
and appends the export results into the run report, so the model card can quote
ONNX numbers without anyone retyping them.

Usage:  python ml/scripts/export_artifacts.py [--alpha 0.10]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from subjectrank.config import ARTIFACTS, CONFIG, REPORTS          # noqa: E402
from subjectrank.export_onnx import export_and_verify              # noqa: E402
from subjectrank.features import FEATURE_SPEC_VERSION              # noqa: E402
from subjectrank.train import run                                  # noqa: E402


def export_all(alpha: float | None = None) -> dict:
    """Train, export every model, verify each graph, write metadata.

    Returned rather than only printed so the Azure ML entry point can call the
    same function instead of carrying its own copy of this loop. One export
    implementation, two callers -- the same argument as subjectrank.promotion.

    Returns {"report", "exports", "failed"}.
    """
    res = run(CONFIG, alpha=alpha)
    report = res["report"]
    fitted, keep_idx, kept_names = res["fitted"], res["keep_idx"], res["kept_names"]
    arms, pairs = res["arms"], res["pairs"]

    corpus = [e["text"] for e in json.loads(
        (ROOT / "parity" / "corpus.json").read_text(encoding="utf-8"))["entries"]]

    # The gauge datum in the UI. Median character count over the ARMS the model
    # actually trained on, so the interface reports the distribution this model
    # saw rather than a number from some other slice of the archive.
    train_test_ids = set(pairs["test_id"])
    train_arms = arms[arms["clickability_test_id"].isin(train_test_ids)]
    char_median = int(np.median([len(h) for h in train_arms["headline"]]))

    all_names = report["features"]["all"]
    excluded = [d["feature"] for d in report["features"]["dropped_low_support"]]
    version = report["run_id"]

    exports: dict = {}
    failed: list = []
    for name, model in fitted.items():
        meta = {
            "version": f"{name}-{version}",
            "algorithm": name,
            "feature_spec_version": FEATURE_SPEC_VERSION,
            "feature_names": kept_names,
            "excluded_features": excluded,
            "training_char_median": char_median,
            "trained_on": {
                "subsets": report["data"]["subsets_loaded"],
                "pairs": report["data"]["n_labelled_pairs"],
                "tests": report["data"]["n_tests"],
                "alpha": report["data"]["alpha_used"],
            },
            "antisymmetry_tolerance": CONFIG.antisymmetry_tolerance,
            "run_id": version,
        }

        # Exact per-feature attribution, for linear models only. The UI marks
        # reasons on the user's own words from these; a model that cannot supply
        # them says so rather than inventing an explanation (see attribution.ts).
        if name == "baseline_logreg":
            meta["coefficients"] = [float(c) for c in model.named_steps["clf"].coef_[0]]
            meta["scale"] = [float(s) for s in model.named_steps["scale"].scale_]

        # A failed export is recorded rather than aborting the whole run: the
        # failure is itself a finding about that model's deployability, and
        # losing a model that passed both gates because a different one failed
        # would be the wrong trade. No metadata is written for a failed export,
        # so promote_model.py still cannot promote it.
        r = export_and_verify(model, keep_idx, kept_names,
                              ARTIFACTS / f"{name}.onnx", corpus, CONFIG,
                              metadata={"run_id": version, "algorithm": name},
                              raise_on_fail=False)
        exports[name] = r

        print(f"{name}")
        print(f"  export fidelity max |delta| {r['max_abs_delta']:.3e} "
              f"(tolerance {r['tolerance']:.1e}) -> {'PASS' if r['passed'] else 'FAIL'}")
        print(f"  delta distribution: median {r['median_abs_delta']:.3e}, "
              f"{r['n_vectors_over_tolerance']} of {r['n_vectors_checked']} vectors "
              f"over tolerance ({r['pct_vectors_over_tolerance']}%)")
        print(f"  ONNX antisymmetry violation {r['antisymmetry_max_violation']:.3e} "
              f"(tolerance {CONFIG.antisymmetry_tolerance:.1e})")

        if not r["passed"]:
            failed.append(name)
            print(f"  REFUSED: {r['failure']}")
            print(f"  no metadata written; this model cannot be promoted.")
            print()
            continue
        if "antisymmetry_warning" in r:
            print(f"  WARNING: {r['antisymmetry_warning']}")

        meta["antisymmetry_max_violation"] = r["antisymmetry_max_violation"]
        meta["onnx_export"] = {k: v for k, v in r.items() if k != "path"}
        (ARTIFACTS / f"{name}.meta.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8")
        print(f"  wrote {name}.onnx ({r['bytes']:,} bytes) and {name}.meta.json")
        print()

    # Fold the ONNX numbers back into the run report so MODEL_CARD.md can quote
    # them without anyone retyping a figure.
    report["onnx_exports"] = exports
    p = REPORTS / f"run_{version}.json"
    p.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"updated {p}")
    return {"report": report, "exports": exports, "failed": failed}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--alpha", type=float, default=None)
    a = ap.parse_args()

    out = export_all(alpha=a.alpha)
    if out["failed"]:
        print()
        print(f"EXPORT GATE FAILED for: {', '.join(out['failed'])}. "
              f"Those models have no artifacts and cannot be promoted.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
