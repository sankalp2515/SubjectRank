"""Azure ML training job entry point.

This does **not** reimplement the pipeline. It calls exactly the same
`subjectrank.train.run()` and the same export-and-verify path that
`ml/scripts/export_artifacts.py` calls locally, so a run in the cloud and a run
on a laptop are the same computation and can be compared directly.

What it adds on top is the part that a local script cannot give you:

  * every metric logged to MLflow, so runs are comparable in the workspace
    instead of by diffing JSON files;
  * the run report, the model card inputs and the ONNX graph kept as job
    outputs, tied to the git SHA and the data version that produced them;
  * the model registered with its gate results as tags, so the registry — not a
    filename — is the record of what may serve traffic.

Usage (inside an Azure ML job; see train_job.yml):
    python azure/ml/entry.py --data-dir ${{inputs.archive}} --register
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from subjectrank.config import ARTIFACTS, CONFIG      # noqa: E402
from subjectrank.features import FEATURE_SPEC_VERSION  # noqa: E402
from subjectrank.promotion import check, sha256        # noqa: E402


def _mlflow():
    """MLflow is present in the Azure ML environment and absent on a laptop.

    Returned as None rather than imported at module scope so this file stays
    runnable locally — the point of sharing the pipeline is undermined if the
    cloud entry point cannot be executed anywhere else.
    """
    try:
        import mlflow  # noqa: PLC0415
        return mlflow
    except ImportError:
        print("mlflow not installed — metrics will print instead of being logged")
        return None


def log_metrics(mf, report: dict) -> None:
    """Flatten the run report into MLflow metrics and params."""
    d, th = report["data"], report["temporal_holdout"]
    if mf:
        mf.log_params({
            "alpha": d["alpha_used"],
            "labelled_pairs": d["n_labelled_pairs"],
            "tests": d["n_tests"],
            "subsets": ",".join(d["subsets_loaded"]),
            "feature_spec_version": FEATURE_SPEC_VERSION,
            "temporal_cutoff": th["cutoff"],
            "min_impressions_per_arm": CONFIG.min_impressions_per_arm,
            "max_pairs_per_test": CONFIG.max_pairs_per_test,
            "random_state": CONFIG.random_state,
        })

    for row in report["cv_group_split"]:
        m = row["model"]
        _log(mf, f"{m}/cv_accuracy", row["cv_accuracy_mean"])
        _log(mf, f"{m}/cv_accuracy_std", row["cv_accuracy_std"])
        _log(mf, f"{m}/cv_auc", row["cv_auc_mean"])

    for m, res in th["results"].items():
        pw, sel, lift, cal = (res["pairwise"], res["selection"],
                              res["lift"], res["calibration"])
        _log(mf, f"{m}/holdout_accuracy", pw["accuracy"])
        _log(mf, f"{m}/holdout_auc", pw["roc_auc"])
        _log(mf, f"{m}/holdout_brier", pw["brier"])
        _log(mf, f"{m}/top1_accuracy", sel["top1_accuracy"])
        _log(mf, f"{m}/top1_random_baseline", sel["top1_baseline_random"])
        _log(mf, f"{m}/ctr_lift_vs_mean_pct", lift["lift_vs_mean_pct"])
        _log(mf, f"{m}/oracle_gap_captured_pct", lift["pct_of_oracle_gap_captured"])
        _log(mf, f"{m}/calibration_max_gap", cal["max_calibration_gap"])
        _log(mf, f"{m}/antisymmetry_python", res["antisymmetry_max_violation"])

    # The TF-IDF variant is logged like any other model. It lost the argument, not
    # the measurement, and hiding the number it won on would be the thing D-025
    # exists to prevent.
    tf = report.get("tfidf_variant")
    if tf:
        tv = tf["temporal_holdout"]
        _log(mf, "variant_tfidf_logreg/cv_accuracy",
             tf["cv_group_split"]["cv_accuracy_mean"])
        _log(mf, "variant_tfidf_logreg/holdout_accuracy", tv["pairwise"]["accuracy"])
        _log(mf, "variant_tfidf_logreg/holdout_auc", tv["pairwise"]["roc_auc"])
        _log(mf, "variant_tfidf_logreg/top1_accuracy", tv["selection"]["top1_accuracy"])

    for m, e in (report.get("onnx_exports") or {}).items():
        _log(mf, f"{m}/onnx_max_abs_delta", e["max_abs_delta"])
        _log(mf, f"{m}/onnx_antisymmetry", e["antisymmetry_max_violation"])
        _log(mf, f"{m}/onnx_export_passed", 1.0 if e["passed"] else 0.0)


def _log(mf, k: str, v) -> None:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return
    if mf:
        mf.log_metric(k, v)
    else:
        print(f"  {k} = {v}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=None,
                    help="Archive CSVs. Defaults to the repo's data/raw.")
    ap.add_argument("--alpha", type=float, default=None)
    ap.add_argument("--register", action="store_true",
                    help="Register passing models in the Azure ML model registry")
    ap.add_argument("--output-dir", default=None,
                    help="Job output directory for artifacts and the run report")
    a = ap.parse_args()

    if a.data_dir:
        # The loader globs config.RAW. Pointing it at the mounted input keeps the
        # pipeline unmodified rather than teaching it about Azure.
        import subjectrank.config as cfg
        cfg.RAW = pathlib.Path(a.data_dir)
        print(f"data dir: {cfg.RAW}")

    mf = _mlflow()

    # Import AFTER the data dir is patched, because train imports data which
    # reads config.RAW at call time -- but export_artifacts resolves ARTIFACTS at
    # import time, so order matters here and getting it wrong trains on nothing.
    sys.path.insert(0, str(ROOT / "ml" / "scripts"))
    from export_artifacts import export_all  # noqa: E402

    result = export_all(alpha=a.alpha)
    report, exports = result["report"], result["exports"]

    log_metrics(mf, report)

    out = pathlib.Path(a.output_dir) if a.output_dir else ARTIFACTS
    out.mkdir(parents=True, exist_ok=True)
    (out / "run_report.json").write_text(
        json.dumps(report, indent=2, default=str), encoding="utf-8")

    registered = []
    for name, e in exports.items():
        meta_path = ARTIFACTS / f"{name}.meta.json"
        if not meta_path.exists():
            print(f"{name}: no metadata (export gate failed) — not registered")
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        gate = check(meta, FEATURE_SPEC_VERSION)
        meta["gate_passed"] = gate.passed
        meta["gate_failures"] = gate.failures
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        if not gate.passed:
            print(f"{name}: gate FAILED — {'; '.join(gate.failures)}")
            print(f"{name}: registered anyway with gate_passed=false, so the "
                  f"registry records the attempt rather than hiding it")

        if a.register:
            registered.append(_register(name, meta, gate.passed))

    print(json.dumps({"registered": registered}, indent=2))
    return 0


def _register(name: str, meta: dict, passed: bool) -> dict:
    """Register the ONNX artifact with its gate result as tags.

    Tags rather than a naming convention: a model called `champion_v3.onnx` tells
    you nothing about whether it passed antisymmetry, and the filename is the
    first thing to go stale.
    """
    from azure.ai.ml import MLClient
    from azure.ai.ml.entities import Model
    from azure.ai.ml.constants import AssetTypes
    from azure.identity import DefaultAzureCredential

    client = MLClient(
        DefaultAzureCredential(),
        subscription_id=os.environ["AZURE_SUBSCRIPTION_ID"],
        resource_group_name=os.environ["AZURE_RESOURCE_GROUP"],
        workspace_name=os.environ["AZURE_ML_WORKSPACE"],
    )

    onnx_path = ARTIFACTS / f"{name}.onnx"
    export = meta.get("onnx_export", {})
    tags = {
        "algorithm": meta.get("algorithm", name),
        "feature_spec_version": str(meta.get("feature_spec_version")),
        "run_id": str(meta.get("run_id")),
        "gate_passed": str(passed).lower(),
        "antisymmetry": f"{meta.get('antisymmetry_max_violation')}",
        "onnx_max_abs_delta": f"{export.get('max_abs_delta')}",
        "onnx_export_passed": str(export.get("passed")).lower(),
        "artifact_sha256": sha256(onnx_path),
        "n_features": str(len(meta.get("feature_names", []))),
        "git_sha": os.environ.get("GIT_SHA", "unknown"),
    }

    registered = client.models.create_or_update(Model(
        path=str(onnx_path),
        name=f"subjectrank-{name.replace('_', '-')}",
        type=AssetTypes.CUSTOM_MODEL,
        description=(
            f"SubjectRank pairwise ranker ({meta.get('algorithm')}). "
            f"Gate: {'PASSED' if passed else 'FAILED'}. "
            f"See MODEL_CARD.md and DECISIONS.md D-013/D-025/D-026."
        ),
        tags=tags,
        properties={"meta": json.dumps(meta)[:8000]},
    ))
    print(f"{name}: registered as {registered.name}:{registered.version}")
    return {"name": registered.name, "version": registered.version,
            "gate_passed": passed}


if __name__ == "__main__":
    raise SystemExit(main())
