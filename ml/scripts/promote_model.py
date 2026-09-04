"""Promote a trained model to the serving path.

Training writes to ml/artifacts/. Serving reads web/model/. The copy between them
is this script, and it is deliberate rather than automatic: what ships should be an
explicit promotion, not whatever happens to be sitting in the training output
directory.

Refuses to promote anything that has not passed its gates:
  - ONNX must reproduce the Python model (checked at export)
  - antisymmetry must be within tolerance, or the promotion must be forced with a
    reason that gets recorded (D-013)
  - feature spec version must match the extractor's

Usage:
  python ml/scripts/promote_model.py [--model baseline_logreg] [--force "reason"]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "ml" / "artifacts"
SERVING = ROOT / "web" / "model"


def sha256(p: pathlib.Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="baseline_logreg")
    ap.add_argument("--force", default=None,
                    help="promote despite a failed gate; the reason is recorded")
    a = ap.parse_args()

    onnx = ARTIFACTS / f"{a.model}.onnx"
    meta_p = ARTIFACTS / f"{a.model}.meta.json"
    if not (onnx.exists() and meta_p.exists()):
        print(f"No artifacts for {a.model!r} in {ARTIFACTS}.\n"
              f"Train first: python -m subjectrank.train", file=sys.stderr)
        return 1

    meta = json.loads(meta_p.read_text(encoding="utf-8"))

    if meta.get("SYNTHETIC"):
        print("REFUSED: that artifact is marked SYNTHETIC. It exists to exercise the "
              "serving path and must never be promoted.", file=sys.stderr)
        return 1

    sys.path.insert(0, str(ROOT / "ml"))
    from subjectrank.features import FEATURE_SPEC_VERSION  # noqa: E402

    if meta.get("feature_spec_version") != FEATURE_SPEC_VERSION:
        print(f"REFUSED: model is feature spec v{meta.get('feature_spec_version')}, "
              f"extractor is v{FEATURE_SPEC_VERSION}. Retrain.", file=sys.stderr)
        return 1

    anti = meta.get("antisymmetry_max_violation")
    tol = meta.get("antisymmetry_tolerance", 1e-6)
    if anti is not None and anti > tol and not a.force:
        print(f"REFUSED: antisymmetry violation {anti:.3e} exceeds {tol:.1e}.\n"
              f"Reordering a user's inputs could change which line wins (D-013).\n"
              f"To promote anyway: --force \"<reason>\" — the reason is recorded in "
              f"the served metadata and belongs in MODEL_CARD.md too.", file=sys.stderr)
        return 1

    SERVING.mkdir(parents=True, exist_ok=True)
    shutil.copy2(onnx, SERVING / "champion.onnx")

    meta["artifact_sha256"] = sha256(SERVING / "champion.onnx")
    meta["promoted_from"] = a.model
    if a.force:
        meta["promoted_with_force"] = a.force
    (SERVING / "champion.meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8")

    print(f"promoted {a.model} -> web/model/champion.onnx")
    print(f"  version {meta.get('version')}  spec v{meta.get('feature_spec_version')}")
    print(f"  {len(meta.get('feature_names', []))} features, "
          f"{len(meta.get('excluded_features', []))} excluded")
    print(f"  sha256 {meta['artifact_sha256'][:16]}...")
    if a.force:
        print(f"  FORCED: {a.force}")
    print("\nNext: python ml/scripts/build_worked_example.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
