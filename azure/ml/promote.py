"""Champion/challenger promotion in the Azure ML model registry.

The local equivalent is `ml/scripts/promote_model.py`, which copies a file into
`web/model/`. This moves the `champion` alias in the registry instead, and the
difference matters: the registry keeps every version, records who promoted what
and when, and lets a rollback be a pointer move rather than a rebuild.

**Both paths call `subjectrank.promotion.check`.** They cannot disagree about
what is shippable, which is the reason that module exists.

What this does NOT do is pick the winner for you. `--model` is explicit, because
D-013 turned on a judgement — a marginal accuracy gain does not buy back a
correctness property — and a script that auto-promotes on top-line accuracy would
have shipped `candidate_lgbm` and its 1.349e-01 antisymmetry violation.

    python azure/ml/promote.py --model baseline_logreg
    python azure/ml/promote.py --model baseline_logreg --version 7
    python azure/ml/promote.py --show
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from subjectrank.features import FEATURE_SPEC_VERSION  # noqa: E402
from subjectrank.promotion import check                # noqa: E402

CHAMPION_ALIAS = "champion"


def client():
    from azure.ai.ml import MLClient
    from azure.identity import DefaultAzureCredential
    missing = [k for k in ("AZURE_SUBSCRIPTION_ID", "AZURE_RESOURCE_GROUP",
                           "AZURE_ML_WORKSPACE") if not os.environ.get(k)]
    if missing:
        raise SystemExit(
            f"Missing environment: {', '.join(missing)}.\n"
            f"See azure/README.md — these come from the Bicep deployment outputs."
        )
    return MLClient(
        DefaultAzureCredential(),
        subscription_id=os.environ["AZURE_SUBSCRIPTION_ID"],
        resource_group_name=os.environ["AZURE_RESOURCE_GROUP"],
        workspace_name=os.environ["AZURE_ML_WORKSPACE"],
    )


def model_name(algorithm: str) -> str:
    return f"subjectrank-{algorithm.replace('_', '-')}"


def show(ml) -> int:
    """What is registered, and what is currently champion."""
    # ASCII only in printed output. Windows consoles default to cp1252, and a
    # single Greek delta in a header crashed this script with UnicodeEncodeError
    # before it could show a thing. Prose in comments and docstrings is fine --
    # only what reaches stdout has to survive the terminal's codec.
    print(f"{'model':34} {'ver':>4}  {'gate':6} {'antisym':>11}  {'onnx delta':>12}  champion")
    print("-" * 88)
    for algorithm in ("baseline_logreg", "candidate_lgbm"):
        name = model_name(algorithm)
        try:
            versions = list(ml.models.list(name=name))
        except Exception as e:  # noqa: BLE001 - the CLI should say why, not trace
            print(f"{name:34}  (not registered: {type(e).__name__})")
            continue
        champ_ver = None
        try:
            champ_ver = ml.models.get(name=name, label=CHAMPION_ALIAS).version
        except Exception:  # noqa: BLE001 - no alias set yet is normal
            pass
        for v in sorted(versions, key=lambda m: int(m.version)):
            t = v.tags or {}
            mark = "  <-- champion" if v.version == champ_ver else ""
            print(f"{name:34} {v.version:>4}  "
                  f"{t.get('gate_passed', '?'):6} "
                  f"{t.get('antisymmetry', '?'):>11}  "
                  f"{t.get('onnx_max_abs_delta', '?'):>10}{mark}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None,
                    help="algorithm name, e.g. baseline_logreg")
    ap.add_argument("--version", default=None,
                    help="registry version; defaults to the latest")
    ap.add_argument("--force", default=None,
                    help="promote despite a forceable gate; the reason is recorded")
    ap.add_argument("--show", action="store_true", help="list what is registered")
    a = ap.parse_args()

    ml = client()
    if a.show or not a.model:
        return show(ml)

    name = model_name(a.model)
    model = (ml.models.get(name=name, version=a.version) if a.version
             else ml.models.get(name=name, label="latest"))

    # The registry stores the full meta as a property; the gates read the same
    # dictionary the local path reads, so the two decisions are the same decision.
    raw = (model.properties or {}).get("meta")
    if not raw:
        raise SystemExit(
            f"{name}:{model.version} has no `meta` property. It was not registered "
            f"by azure/ml/entry.py, so its gate results are unknown and it will "
            f"not be promoted on trust."
        )
    meta = json.loads(raw)

    gate = check(meta, FEATURE_SPEC_VERSION, force=a.force)
    if gate.failures or gate.warnings:
        print(gate.report(), file=sys.stderr)
    if not gate.passed:
        return 1

    # The alias is the promotion. Nothing is copied, nothing is rebuilt, and the
    # previous champion stays exactly where it was for a one-command rollback.
    ml.models.create_or_update_alias(  # type: ignore[attr-defined]
        name=name, version=model.version, alias=CHAMPION_ALIAS,
    ) if hasattr(ml.models, "create_or_update_alias") else _tag_fallback(ml, name, model)

    print(f"champion -> {name}:{model.version}")
    print(f"  algorithm      {meta.get('algorithm')}")
    print(f"  spec           v{meta.get('feature_spec_version')}")
    print(f"  antisymmetry   {meta.get('antisymmetry_max_violation')}")
    print(f"  sha256         {(model.tags or {}).get('artifact_sha256', '?')[:16]}...")
    if a.force:
        print(f"  FORCED: {a.force}")
    print("\nNext: CI fetches this alias and bakes it into the image "
          "(azure/ml/fetch_model.py).")
    return 0


def _tag_fallback(ml, name: str, model) -> None:
    """Older SDKs have no alias API. Fall back to a tag, and say so.

    A silent fallback would leave someone reading `champion` in one place and a
    tag in another with no idea the two mechanisms exist.
    """
    print("note: this azure-ai-ml has no alias API; setting tag champion=true "
          "and clearing it from other versions instead", file=sys.stderr)
    for v in ml.models.list(name=name):
        tags = dict(v.tags or {})
        want = "true" if v.version == model.version else "false"
        if tags.get(CHAMPION_ALIAS) != want:
            tags[CHAMPION_ALIAS] = want
            v.tags = tags
            ml.models.create_or_update(v)


if __name__ == "__main__":
    raise SystemExit(main())
