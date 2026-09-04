"""The gates a model must pass before it may serve traffic — in one place.

There are now two promotion paths: `ml/scripts/promote_model.py` copies an
artifact into `web/model/` for a local run, and `azure/ml/promote.py` moves the
`champion` alias in the Azure ML model registry for a deploy. If each carried its
own copy of the rules, the two could disagree about what is shippable, and the
disagreement would surface as a model that is champion in the registry and
refused locally, or worse the reverse.

This is the same argument as D-006 — one specification, implemented once — applied
to promotion rather than to features.

Every gate here answers the same question: **would shipping this artifact make a
claim the project cannot defend?**
"""
from __future__ import annotations

import hashlib
import pathlib
from dataclasses import dataclass, field
from typing import Dict, List, Optional


def sha256(p: pathlib.Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


@dataclass
class GateResult:
    passed: bool
    failures: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    forced: Optional[str] = None

    def report(self) -> str:
        lines = []
        for f in self.failures:
            lines.append(f"REFUSED: {f}")
        for w in self.warnings:
            lines.append(f"WARNING: {w}")
        if self.forced:
            lines.append(f"FORCED: {self.forced}")
        return "\n".join(lines)


def check(meta: Dict, extractor_spec_version: int,
          force: Optional[str] = None) -> GateResult:
    """Decide whether `meta` describes an artifact that may serve traffic.

    `meta` is the `<model>.meta.json` written by `ml/scripts/export_artifacts.py`,
    or the equivalent tag bag read back from the Azure ML model registry.
    """
    failures: List[str] = []
    warnings: List[str] = []

    # 1. Synthetic artifacts exist to exercise the serving path on a machine with
    #    no data. Shipping one would put fabricated rankings in front of people,
    #    which is the single thing this project exists to argue against. Not
    #    forceable.
    if meta.get("SYNTHETIC") or meta.get("synthetic") in (True, "true", "True"):
        failures.append(
            "this artifact is marked SYNTHETIC. It exists to exercise the serving "
            "path and must never be promoted, with or without --force."
        )

    # 2. A model trained under one feature spec served by an extractor at another
    #    produces numbers that are wrong in a way nothing downstream can detect.
    #    Not forceable either.
    spec = meta.get("feature_spec_version")
    if spec != extractor_spec_version:
        failures.append(
            f"model is feature spec v{spec}, extractor is "
            f"v{extractor_spec_version}. The two disagree about what the numbers "
            f"mean. Retrain or roll back — see RUNBOOK.md."
        )

    # 3. The ONNX export must reproduce the Python model it came from. A graph
    #    that is a different function is not the model that was evaluated, so
    #    every metric in the model card would describe something else.
    export = meta.get("onnx_export") or {}
    if export and not export.get("passed", True):
        failures.append(
            f"the ONNX export does not reproduce the Python model: max delta "
            f"{export.get('max_abs_delta')} against tolerance "
            f"{export.get('tolerance')}. See D-026."
        )

    # 4. Antisymmetry. This one IS forceable, because a small violation is a
    #    product tradeoff rather than a correctness impossibility — but the reason
    #    is recorded in the served metadata and belongs in MODEL_CARD.md.
    anti = meta.get("antisymmetry_max_violation")
    tol = meta.get("antisymmetry_tolerance", 1e-6)
    if anti is not None and anti > tol:
        msg = (
            f"antisymmetry violation {anti:.3e} exceeds {tol:.1e}. Reordering a "
            f"user's inputs could change which line wins (D-013)."
        )
        if force:
            warnings.append(msg)
        else:
            failures.append(
                msg + ' To promote anyway: --force "<reason>" — the reason is '
                "recorded in the served metadata."
            )

    return GateResult(
        passed=not failures,
        failures=failures,
        warnings=warnings,
        forced=force if (force and warnings) else None,
    )
