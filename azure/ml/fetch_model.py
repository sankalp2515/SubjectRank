"""Pull the registry's current champion into web/model/ so the image can bake it.

This is the join between the two halves of the system. Azure ML decides *which*
model is champion; the container build decides *what ships*. This script is the
only thing that carries a model across that line, and it verifies the crossing:

  * the artifact's sha256 must match the hash recorded at registration, so a
    corrupted or swapped blob fails the build rather than the request;
  * the feature spec version must match the extractor in this checkout, so a
    container is never built from a model the code cannot serve correctly;
  * the gate result recorded in the registry must say `passed`.

    python azure/ml/fetch_model.py --into web/model
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from subjectrank.features import FEATURE_SPEC_VERSION  # noqa: E402
from subjectrank.promotion import check, sha256        # noqa: E402

CHAMPION_ALIAS = "champion"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--into", default="web/model")
    ap.add_argument("--model", default="baseline_logreg",
                    help="algorithm whose champion alias to fetch")
    a = ap.parse_args()

    from azure.ai.ml import MLClient
    from azure.identity import DefaultAzureCredential

    ml = MLClient(
        DefaultAzureCredential(),
        subscription_id=os.environ["AZURE_SUBSCRIPTION_ID"],
        resource_group_name=os.environ["AZURE_RESOURCE_GROUP"],
        workspace_name=os.environ["AZURE_ML_WORKSPACE"],
    )

    name = f"subjectrank-{a.model.replace('_', '-')}"
    try:
        model = ml.models.get(name=name, label=CHAMPION_ALIAS)
    except Exception:  # noqa: BLE001
        print(f"No `{CHAMPION_ALIAS}` alias on {name}. Promote one first:\n"
              f"  python azure/ml/promote.py --model {a.model}", file=sys.stderr)
        return 1

    meta = json.loads((model.properties or {}).get("meta") or "{}")
    if not meta:
        print(f"{name}:{model.version} carries no meta property; refusing to ship "
              f"a model whose gate results are unknown.", file=sys.stderr)
        return 1

    # Re-run the gates here rather than trusting the tag. The tag was written by
    # whatever code registered the model; this checkout's extractor is the thing
    # that has to serve it.
    gate = check(meta, FEATURE_SPEC_VERSION)
    if not gate.passed:
        print(gate.report(), file=sys.stderr)
        print(f"\n{name}:{model.version} is the champion alias but does not pass "
              f"the gates in this checkout. Not building an image from it.",
              file=sys.stderr)
        return 1

    into = (ROOT / a.into) if not pathlib.Path(a.into).is_absolute() else pathlib.Path(a.into)
    into.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        ml.models.download(name=name, version=model.version, download_path=tmp)
        found = list(pathlib.Path(tmp).rglob("*.onnx"))
        if len(found) != 1:
            print(f"expected exactly one .onnx in the downloaded model, found "
                  f"{len(found)}: {[str(f) for f in found]}", file=sys.stderr)
            return 1

        expected = (model.tags or {}).get("artifact_sha256")
        actual = sha256(found[0])
        if expected and expected != actual:
            print(f"sha256 MISMATCH.\n  registry: {expected}\n  download: {actual}\n"
                  f"The bytes in the registry are not the bytes that were "
                  f"registered. Refusing to build.", file=sys.stderr)
            return 1

        shutil.copy2(found[0], into / "champion.onnx")

    meta["artifact_sha256"] = actual
    meta["promoted_from"] = a.model
    meta["registry"] = {"name": name, "version": model.version,
                        "alias": CHAMPION_ALIAS}
    (into / "champion.meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8")

    print(f"fetched {name}:{model.version} -> {into}/champion.onnx")
    print(f"  spec v{meta.get('feature_spec_version')}  "
          f"{len(meta.get('feature_names', []))} features  sha {actual[:16]}...")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
