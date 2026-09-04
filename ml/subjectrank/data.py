"""Load the Upworthy archive, filter it honestly, and build pairwise training data.

Every stage logs how many rows/pairs it removed. Those counts are not decoration:
"how many pairs survived your image filter?" is an interview question and the
answer should be a table, not a shrug.
"""
from __future__ import annotations

import itertools
import json
import pathlib
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .config import (CONFIG, FILE_PATTERNS, PUBLISHED_COUNTS, RAW,
                     REQUIRED_COLUMNS, Config)


class DataError(RuntimeError):
    """Raised when the data is not what the pipeline was told to expect.

    Deliberately fatal. Per the mission's escalation rule, a schema surprise stops
    the run and gets written up -- it is never worked around by improvising.
    """


@dataclass
class Ledger:
    """Row/pair accounting. Every filter reports what it cost."""
    stages: List[Tuple[str, int, str]] = field(default_factory=list)

    def record(self, name: str, remaining: int, note: str = "") -> None:
        self.stages.append((name, remaining, note))

    def to_markdown(self) -> str:
        lines = ["| stage | remaining | removed | note |", "|---|---:|---:|---|"]
        prev = None
        for name, n, note in self.stages:
            removed = "" if prev is None else f"{prev - n:,}"
            lines.append(f"| {name} | {n:,} | {removed} | {note} |")
            prev = n
        return "\n".join(lines)

    def to_dict(self) -> List[Dict]:
        return [{"stage": s, "remaining": n, "note": note} for s, n, note in self.stages]


def discover_files(raw_dir: pathlib.Path = RAW) -> Dict[str, pathlib.Path]:
    """Find whichever archive subsets are actually present.

    Nothing is hardcoded about which subsets we have: see Q-001. The pipeline
    reports the corpus it actually loaded so no claim can drift from reality.
    """
    found: Dict[str, pathlib.Path] = {}
    for subset, pattern in FILE_PATTERNS.items():
        matches = sorted(raw_dir.glob(pattern))
        if len(matches) > 1:
            raise DataError(f"multiple files match {pattern!r}: {matches}")
        if matches:
            found[subset] = matches[0]
    return found


def load_subset(path: pathlib.Path, subset: str, verify: bool = True) -> pd.DataFrame:
    df = pd.read_csv(path, low_memory=False)

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise DataError(
            f"{path.name} is missing required columns {missing}.\n"
            f"Columns present: {sorted(df.columns)}\n"
            f"The pipeline assumes the schema documented at "
            f"https://upworthy.natematias.com/about-the-archive.html. "
            f"Stop and update docs/ rather than guessing a mapping."
        )

    if verify and subset in PUBLISHED_COUNTS:
        exp = PUBLISHED_COUNTS[subset]
        got_tests = df["clickability_test_id"].nunique()
        got_pkgs = len(df)
        if got_tests != exp["tests"] or got_pkgs != exp["packages"]:
            raise DataError(
                f"{path.name} does not match the published counts for the "
                f"{subset} subset.\n"
                f"  expected {exp['tests']:,} tests / {exp['packages']:,} packages\n"
                f"  got      {got_tests:,} tests / {got_pkgs:,} packages\n"
                f"Either this is not the file it claims to be, or the download is "
                f"truncated. Both are reasons to stop, not to continue."
            )
    df["__subset"] = subset
    return df


def load_all(raw_dir: pathlib.Path = RAW, verify: bool = True
             ) -> Tuple[pd.DataFrame, Dict[str, pathlib.Path]]:
    files = discover_files(raw_dir)
    if not files:
        raise DataError(
            f"No archive CSVs in {raw_dir}.\n"
            f"See docs/GET_THE_DATA.md -- the download is a manual step by design "
            f"(D-001): OSF is unreachable from this environment."
        )
    frames = [load_subset(p, s, verify=verify) for s, p in sorted(files.items())]
    return pd.concat(frames, ignore_index=True), files


# --- cleaning --------------------------------------------------------------

def clean(df: pd.DataFrame, cfg: Config = CONFIG,
          ledger: Optional[Ledger] = None) -> pd.DataFrame:
    led = ledger if ledger is not None else Ledger()
    led.record("packages loaded", len(df), "raw rows across all loaded subsets")

    df = df[df["headline"].notna()].copy()
    df["headline"] = df["headline"].astype(str)
    df = df[df["headline"].str.strip() != ""]
    led.record("headline present", len(df), "dropped null/blank headlines")

    for c in ("clicks", "impressions"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df[df["clicks"].notna() & df["impressions"].notna()]
    df = df[(df["impressions"] > 0) & (df["clicks"] >= 0)]
    df = df[df["clicks"] <= df["impressions"]]
    led.record("outcomes valid", len(df),
               "impressions > 0, 0 <= clicks <= impressions")

    if cfg.drop_problem_rows and "problem" in df.columns:
        flag = pd.to_numeric(df["problem"], errors="coerce").fillna(0)
        df = df[flag == 0]
        led.record("problem flag clear", len(df),
                   "archive's own randomisation-failure flag")

    df = df[df["eyecatcher_id"].notna()]
    led.record("image id present", len(df), "needed for the D-003 filter")

    # Some packages appear as multiple rows. Sum outcomes within
    # (test, image, headline) so each arm is one row with its full exposure.
    # format="ISO8601" is load-bearing, not tidiness. The archive mixes two
    # timestamp shapes - "2014-11-20 06:43:16.005" and "2015-03-12 18:04:35" -
    # and pandas infers a single format from the first rows, coercing the other
    # shape to NaT. On the exploratory subset that silently nulled 896 of 22,666
    # dates (4%), which would have corrupted the temporal holdout while every
    # other check still passed.
    df["created_at"] = pd.to_datetime(
        df["created_at"], errors="coerce", utc=True, format="ISO8601")
    bad = int(df["created_at"].isna().sum())
    if bad:
        raise DataError(
            f"{bad:,} of {len(df):,} created_at values failed to parse even as "
            f"ISO8601. The temporal split (D-005) depends on these, so this stops "
            f"the run rather than silently producing a split over partial dates."
        )
    agg = (df.groupby(["clickability_test_id", "eyecatcher_id", "headline"],
                      as_index=False)
             .agg(clicks=("clicks", "sum"),
                  impressions=("impressions", "sum"),
                  created_at=("created_at", "min"),
                  subset=("__subset", "first")))
    led.record("arms after aggregation", len(agg),
               "summed duplicate rows within (test, image, headline)")

    agg = agg[agg["impressions"] >= cfg.min_impressions_per_arm]
    led.record("arm impressions >= threshold", len(agg),
               f"min_impressions_per_arm = {cfg.min_impressions_per_arm}")

    agg["ctr"] = agg["clicks"] / agg["impressions"]
    agg.attrs["ledger"] = led
    return agg


# --- pairing ---------------------------------------------------------------

def build_pairs(arms: pd.DataFrame, cfg: Config = CONFIG,
                ledger: Optional[Ledger] = None) -> pd.DataFrame:
    """All within-test, within-image arm pairs. D-003.

    Grouping on (test, image) rather than (test) is the whole ballgame: Upworthy
    varied headline AND image, so a cross-image comparison measures a joint effect
    and attributing it to the headline is simply wrong.
    """
    led = ledger if ledger is not None else arms.attrs.get("ledger", Ledger())

    keys = (["clickability_test_id", "eyecatcher_id"] if cfg.require_same_image
            else ["clickability_test_id"])
    if not cfg.require_same_image:
        raise DataError(
            "require_same_image=False produces image-confounded pairs. If you are "
            "deliberately running the ablation, do it in a script that names itself "
            "an ablation -- do not let a shipped model take this path (D-003)."
        )

    rng = np.random.default_rng(cfg.random_state)
    rows = []
    n_groups = 0
    n_singleton = 0
    n_capped = 0

    for key, g in arms.groupby(keys, sort=False):
        n_groups += 1
        if len(g) < 2:
            n_singleton += 1
            continue
        idx = list(range(len(g)))
        combos = list(itertools.combinations(idx, 2))
        if len(combos) > cfg.max_pairs_per_test:
            sel = rng.choice(len(combos), size=cfg.max_pairs_per_test, replace=False)
            combos = [combos[i] for i in sorted(sel)]
            n_capped += 1
        recs = g.to_dict("records")
        for i, jj in combos:
            a, b = recs[i], recs[jj]
            rows.append({
                "test_id": a["clickability_test_id"],
                "image_id": a["eyecatcher_id"],
                "headline_a": a["headline"], "headline_b": b["headline"],
                "clicks_a": a["clicks"], "impressions_a": a["impressions"],
                "clicks_b": b["clicks"], "impressions_b": b["impressions"],
                "ctr_a": a["ctr"], "ctr_b": b["ctr"],
                "created_at": min(a["created_at"], b["created_at"]),
                "subset": a["subset"],
            })

    pairs = pd.DataFrame(rows)
    led.record("candidate pairs", len(pairs),
               f"within (test, image); {n_singleton:,} of {n_groups:,} groups were "
               f"singletons; {n_capped:,} groups capped at {cfg.max_pairs_per_test}")

    if cfg.drop_identical_headlines and len(pairs):
        pairs = pairs[pairs["headline_a"] != pairs["headline_b"]]
        led.record("distinct headlines", len(pairs),
                   "identical text in both arms carries no headline signal")

    pairs.attrs["ledger"] = led
    return pairs.reset_index(drop=True)
