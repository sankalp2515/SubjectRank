"""End-to-end training run. Writes reports; promotes nothing on its own.

Usage:  python -m subjectrank.train [--alpha 0.10] [--quick]

Everything this prints, it also writes to ml/reports/ as JSON so that
EXPERIMENTS.md entries are transcribed from a file rather than from memory.
"""
from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from dataclasses import asdict
from typing import Dict, List

import numpy as np
import pandas as pd

from . import data as D
from .config import ARTIFACTS, CONFIG, INTERIM, REPORTS, Config
from .dataset import build_xy, feature_support
from .evaluate import full_report, pairwise_metrics
from .labels import alpha_sweep, label_pairs
from .models import make_baseline, make_candidate, prob_fn
from .splits import group_folds, temporal_split
from .tfidf_variant import evaluate as evaluate_tfidf

PROBE = [
    "9 Things You Didn't Know About Your Own Body",
    "The One Chart That Explains Income Inequality",
    "quick question",
    "Last chance: 40% off ends tonight",
    "We're shutting down. Here's what happens to your data.",
]


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def prepare(cfg: Config, alpha: float | None = None) -> Dict:
    df, files = D.load_all()
    _log(f"loaded {len(files)} subset(s): {', '.join(sorted(files))}")

    ledger = D.Ledger()
    arms = D.clean(df, cfg, ledger)
    pairs_all = D.build_pairs(arms, cfg, ledger)

    sweep = alpha_sweep(pairs_all, cfg)
    _log("alpha sweep (D-010):\n" + sweep.to_string(index=False))

    pairs = label_pairs(pairs_all, cfg, alpha=alpha, ledger=ledger)
    _log(f"labelled pairs: {len(pairs):,} at alpha={pairs.attrs['alpha']}")
    _log("pair ledger:\n" + ledger.to_markdown())

    if len(pairs) < 500:
        raise D.DataError(
            f"only {len(pairs):,} labelled pairs survived the filters. That is too "
            f"few to train on honestly. Report this as a finding and revisit the "
            f"thresholds explicitly -- do not quietly relax the D-003 image filter."
        )

    return {"arms": arms, "pairs": pairs, "ledger": ledger,
            "sweep": sweep, "files": {k: str(v) for k, v in files.items()},
            "subsets_loaded": sorted(files)}


def run(cfg: Config = CONFIG, alpha: float | None = None, quick: bool = False) -> Dict:
    t0 = time.time()
    prep = prepare(cfg, alpha)
    arms, pairs = prep["arms"], prep["pairs"]

    X, y, groups, names = build_xy(pairs, cfg, augment=True)
    _log(f"design matrix {X.shape}, label balance {y.mean():.4f} "
         f"(0.5 by construction after augmentation)")

    support = feature_support(X, names)
    weak = support[support["support"] < cfg.min_feature_support]
    keep_idx = [i for i, n in enumerate(names)
                if n not in set(weak["feature"])]
    kept_names = [names[i] for i in keep_idx]
    if len(weak):
        _log(f"D-012: dropping {len(weak)} feature(s) below support "
             f"{cfg.min_feature_support}: {', '.join(weak['feature'])}")
    Xk = X[:, keep_idx]

    # --- model selection on grouped folds (D-005) ---
    fold_rows: List[Dict] = []
    # Materialised once, so every model -- including the TF-IDF variant, which
    # does not share the design matrix -- is scored on identical folds.
    folds = list(group_folds(pairs, cfg))
    if quick:
        folds = folds[:1]
    specs = {"baseline_logreg": make_baseline, "candidate_lgbm": make_candidate}
    for name, ctor in specs.items():
        accs, aucs = [], []
        for k, (tr, te) in enumerate(folds):
            # Fold indices address `pairs`; the augmented matrix stacks the same
            # rows twice, so each pair's mirror must follow it into the same fold
            # or the model sees the reverse of a test pair during training.
            n = len(pairs)
            tr_aug = np.concatenate([tr, tr + n])
            te_aug = np.concatenate([te, te + n])
            m = ctor(cfg)
            m.fit(Xk[tr_aug], y[tr_aug])
            p = prob_fn(m)(Xk[te_aug])
            pm = pairwise_metrics(y[te_aug], p)
            accs.append(pm.accuracy)
            aucs.append(pm.roc_auc)
        fold_rows.append({"model": name,
                          "cv_accuracy_mean": float(np.mean(accs)),
                          "cv_accuracy_std": float(np.std(accs)),
                          "cv_auc_mean": float(np.mean(aucs)),
                          "cv_auc_std": float(np.std(aucs)),
                          "n_folds": len(accs)})
        _log(f"{name}: CV acc {np.mean(accs):.4f} +/- {np.std(accs):.4f}, "
             f"AUC {np.mean(aucs):.4f}")

    # --- honest final number on the temporal holdout (D-005) ---
    tr, te, cutoff = temporal_split(pairs, cfg)
    _log(f"temporal holdout: {len(te):,} pairs from {len(set(pairs.iloc[te]['test_id'])):,} "
         f"tests on/after {cutoff}")
    n = len(pairs)
    tr_aug = np.concatenate([tr, tr + n])
    te_aug = np.concatenate([te, te + n])
    holdout_test_ids = set(pairs.iloc[te]["test_id"])

    final: Dict[str, Dict] = {}
    fitted = {}
    for name, ctor in specs.items():
        m = ctor(cfg)
        m.fit(Xk[tr_aug], y[tr_aug])
        fitted[name] = m

        def prob_full(Dm, _m=m, _idx=keep_idx):
            Dm = np.asarray(Dm, dtype=np.float64)
            if Dm.ndim == 1:
                Dm = Dm.reshape(1, -1)
            return _m.predict_proba(Dm[:, _idx])[:, 1]

        rep = full_report(prob_full, X[te_aug], y[te_aug],
                          arms, holdout_test_ids, PROBE)
        final[name] = rep
        s, l = rep["selection"], rep["lift"]
        _log(f"{name} TEMPORAL HOLDOUT: pairwise {rep['pairwise']['accuracy']:.4f} "
             f"AUC {rep['pairwise']['roc_auc']:.4f} | top-1 "
             f"{s['top1_accuracy']:.4f} vs random {s['top1_baseline_random']:.4f} | "
             f"lift vs mean {l['lift_vs_mean_pct']:+.2f}% | "
             f"antisym {rep['antisymmetry_max_violation']:.2e}")

    # --- the documented rejection, with a number attached (FEATURES.md 6) ---
    _log("evaluating the TF-IDF variant (same learner, same folds)")
    tfidf = evaluate_tfidf(pairs, arms, folds, tr, te, cfg)
    tv = tfidf["temporal_holdout"]
    _log(f"variant_tfidf_logreg: CV acc {tfidf['cv_group_split']['cv_accuracy_mean']:.4f} "
         f"| TEMPORAL HOLDOUT pairwise {tv['pairwise']['accuracy']:.4f} "
         f"AUC {tv['pairwise']['roc_auc']:.4f} | top-1 {tv['selection']['top1_accuracy']:.4f} "
         f"| {tv['n_features']:,} features")

    out = {
        "run_id": time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()),
        "config": cfg.to_dict(),
        "environment": {"python": sys.version.split()[0], "platform": platform.platform()},
        "data": {"subsets_loaded": prep["subsets_loaded"], "files": prep["files"],
                 "ledger": prep["ledger"].to_dict(),
                 "ledger_markdown": prep["ledger"].to_markdown(),
                 "alpha_sweep": prep["sweep"].to_dict("records"),
                 "alpha_used": float(pairs.attrs["alpha"]),
                 "n_labelled_pairs": int(len(pairs)),
                 "n_tests": int(pairs["test_id"].nunique())},
        "features": {"all": names, "kept": kept_names,
                     "dropped_low_support": weak.to_dict("records"),
                     "support": support.to_dict("records")},
        "cv_group_split": fold_rows,
        "tfidf_variant": tfidf,
        "temporal_holdout": {"cutoff": str(cutoff),
                             "n_pairs": int(len(te)),
                             "n_tests": int(len(holdout_test_ids)),
                             "results": final},
        "wall_seconds": round(time.time() - t0, 1),
    }

    REPORTS.mkdir(parents=True, exist_ok=True)
    p = REPORTS / f"run_{out['run_id']}.json"
    p.write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    _log(f"wrote {p}")
    return {"report": out, "fitted": fitted, "keep_idx": keep_idx,
            "kept_names": kept_names, "pairs": pairs, "arms": arms}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--alpha", type=float, default=None)
    ap.add_argument("--quick", action="store_true", help="one CV fold only")
    a = ap.parse_args()
    run(CONFIG, alpha=a.alpha, quick=a.quick)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
