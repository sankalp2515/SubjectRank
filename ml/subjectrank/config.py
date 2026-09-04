"""Single place for every knob. Anything tuned lives here, not inline in a script,
so that EXPERIMENTS.md can record exactly which configuration produced a run."""
from __future__ import annotations

import pathlib
from dataclasses import dataclass, field, asdict
from typing import Dict, List

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
INTERIM = ROOT / "data" / "interim"
ARTIFACTS = ROOT / "ml" / "artifacts"
REPORTS = ROOT / "ml" / "reports"

# Published counts from Matias et al. 2021 (Sci Data 8:195), Table 1. The loader
# asserts against these: if a file does not match, we have the wrong file or a
# truncated download, and that must stop the pipeline rather than quietly train
# on whatever arrived.
PUBLISHED_COUNTS: Dict[str, Dict[str, int]] = {
    "exploratory":  {"tests": 4873,  "packages": 22666},
    "confirmatory": {"tests": 22743, "packages": 105551},
    "holdout":      {"tests": 4871,  "packages": 22600},
}

FILE_PATTERNS: Dict[str, str] = {
    "exploratory":  "upworthy-archive-exploratory-packages-*.csv",
    "confirmatory": "upworthy-archive-confirmatory-packages-*.csv",
    "holdout":      "upworthy-archive-holdout-packages-*.csv",
}

# D-004. Asserted disjoint from the feature list; never read as model input.
BANNED_AS_FEATURES = ("impressions", "clicks", "winner", "first_place",
                      "significance", "eyecatcher_id", "clickability_test_id")

REQUIRED_COLUMNS = ("clickability_test_id", "headline", "clicks", "impressions",
                    "eyecatcher_id", "created_at")


@dataclass
class Config:
    # --- pair construction ---
    require_same_image: bool = True          # D-003. Never set False for a shipped model.
    drop_problem_rows: bool = True           # archive's own randomisation-failure flag
    min_impressions_per_arm: int = 100       # below this, CTR is mostly noise
    drop_identical_headlines: bool = True    # same text in both arms carries no signal
    max_pairs_per_test: int = 40             # caps combinatorial blowup on large tests

    # --- labelling (D-010) ---
    z_test_alpha: float = 0.10               # swept; see EXPERIMENTS.md
    z_alpha_sweep: List[float] = field(
        default_factory=lambda: [0.05, 0.10, 0.20, 0.50, 1.00])

    # --- splits (D-005) ---
    n_folds: int = 5
    temporal_holdout_frac: float = 0.20      # most recent 20% of tests by date
    random_state: int = 20260826

    # --- features ---
    # D-012: emoji are near-absent from 2013-2015 headlines. If support in the
    # training pairs falls below this, the emoji features are dropped from the
    # model rather than shipped as coefficients fitted on almost no data.
    min_feature_support: float = 0.001       # fraction of pairs with a non-zero diff

    # --- models ---
    lgbm_params: Dict = field(default_factory=lambda: {
        "objective": "binary", "n_estimators": 400, "learning_rate": 0.05,
        "num_leaves": 31, "min_child_samples": 50, "subsample": 0.8,
        "subsample_freq": 1, "colsample_bytree": 0.8, "reg_lambda": 1.0,
        "verbose": -1,
    })
    logreg_params: Dict = field(default_factory=lambda: {
        "C": 1.0, "max_iter": 2000, "solver": "lbfgs",
    })

    # --- serving ---
    antisymmetry_tolerance: float = 1e-6
    onnx_parity_tolerance: float = 1e-5

    def to_dict(self) -> Dict:
        return asdict(self)


CONFIG = Config()
