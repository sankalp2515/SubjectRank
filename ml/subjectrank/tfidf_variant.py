"""The TF-IDF variant that `docs/FEATURES.md` §6 says exists to be evaluated.

§6 predicts this loses and gets rejected because a fitted vectoriser's
tokenisation cannot be reproduced exactly in TypeScript. That prediction is worth
nothing until someone measures the margin, so this module measures it.

**The learner is held constant.** This is logistic regression on TF-IDF difference
vectors, against logistic regression on hand-feature difference vectors — the same
model class, the same augmentation, the same splits. Swapping in LightGBM here (as
an early draft of `EXPERIMENTS.md` sketched, under the name `candidate_lgbm_tfidf`)
would confound the representation change with a learner change and make the
resulting margin uninterpretable. The question §6 asks is about the *features*.

**The vectoriser is fitted on training text only**, inside each split. Fitting it
once on everything would leak the holdout's vocabulary and IDF weights into the
model, and would do it invisibly — the metrics would simply come back better.
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Dict, List, Sequence, Tuple

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion

from .config import CONFIG, Config
from .evaluate import LiftMetrics, SelectionMetrics, pairwise_metrics


def _vectoriser() -> FeatureUnion:
    """Word 1-2 grams plus character 3-5 grams.

    Deliberately the strong version rather than a strawman: if the rejection is
    going to be recorded as a decision, it has to be a rejection of the best
    reasonable TF-IDF setup, not of a weak one chosen to lose.
    """
    return FeatureUnion([
        ("word", TfidfVectorizer(analyzer="word", ngram_range=(1, 2),
                                 min_df=3, sublinear_tf=True, lowercase=True)),
        ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5),
                                 min_df=3, sublinear_tf=True, lowercase=True)),
    ])


def _fit(a: Sequence[str], b: Sequence[str], y: np.ndarray, cfg: Config):
    vec = _vectoriser()
    # Fit on both sides of the training pairs, and on nothing else.
    vec.fit(list(a) + list(b))
    A, B = vec.transform(a), vec.transform(b)
    Dm = A - B
    # D-009: the same both-directions augmentation the hand-feature models get.
    X = sparse.vstack([Dm, -Dm], format="csr")
    Y = np.concatenate([y, 1 - y]).astype(np.int8)
    clf = LogisticRegression(fit_intercept=False, C=cfg.logreg_params["C"],
                             max_iter=cfg.logreg_params["max_iter"],
                             solver="liblinear")
    clf.fit(X, Y)
    return vec, clf


def _prob(vec, clf, a: Sequence[str], b: Sequence[str]) -> np.ndarray:
    Dm = vec.transform(a) - vec.transform(b)
    return clf.predict_proba(Dm)[:, 1]


def _selection_and_lift(vec, clf, arms: pd.DataFrame, test_ids,
                        group_cols=("clickability_test_id", "eyecatcher_id")) -> Dict:
    """Text-space twin of evaluate.selection_and_lift.

    Written out rather than reused because the shared version ranks through
    `features.extract`, and the whole point of this variant is that it does not
    use those features.
    """
    df = arms[arms[group_cols[0]].isin(set(test_ids))]
    chosen, mean_c, best_c, worst_c, n_arms = [], [], [], [], []
    hits = 0
    evaluated_tests = set()

    for _, g in df.groupby(list(group_cols), sort=False):
        if len(g) < 2:
            continue
        texts = g["headline"].tolist()
        if len(set(texts)) < 2:
            continue
        ctrs = g["ctr"].to_numpy(dtype=np.float64)
        n = len(texts)
        idx = [(i, j) for i in range(n) for j in range(n) if i != j]
        p = _prob(vec, clf, [texts[i] for i, _ in idx], [texts[j] for _, j in idx])
        P = np.full((n, n), 0.5)
        for (i, j), v in zip(idx, p):
            P[i, j] = v
        off = ~np.eye(n, dtype=bool)
        scores = np.array([P[i][off[i]].mean() for i in range(n)])
        pick = int(np.argsort(-scores, kind="mergesort")[0])

        hits += int(pick == int(np.argmax(ctrs)))
        n_arms.append(n)
        evaluated_tests.add(g[group_cols[0]].iloc[0])
        chosen.append(ctrs[pick]); mean_c.append(ctrs.mean())
        best_c.append(ctrs.max()); worst_c.append(ctrs.min())

    k = len(n_arms)
    if k == 0:
        return {"selection": None, "lift": None}
    cm, mm = float(np.mean(chosen)), float(np.mean(mean_c))
    bm, wm = float(np.mean(best_c)), float(np.mean(worst_c))
    gap = bm - mm
    sel = SelectionMetrics(
        n_groups=k, n_tests=len(evaluated_tests), top1_accuracy=hits / k,
        top1_baseline_random=float(np.mean([1.0 / a for a in n_arms])),
        mean_arms_per_group=float(np.mean(n_arms)))
    lift = LiftMetrics(
        n_groups=k, ctr_model_choice=cm, ctr_mean_arm=mm,
        ctr_best_arm=bm, ctr_worst_arm=wm,
        lift_vs_mean_pct=100.0 * (cm - mm) / mm if mm else float("nan"),
        lift_vs_worst_pct=100.0 * (cm - wm) / wm if wm else float("nan"),
        pct_of_oracle_gap_captured=100.0 * (cm - mm) / gap if gap else float("nan"))
    return {"selection": asdict(sel), "lift": asdict(lift)}


def evaluate(pairs: pd.DataFrame, arms: pd.DataFrame,
             folds: List[Tuple[np.ndarray, np.ndarray]],
             tr: np.ndarray, te: np.ndarray,
             cfg: Config = CONFIG) -> Dict:
    """CV on the group folds, then the honest number on the temporal holdout."""
    a_all = pairs["headline_a"].tolist()
    b_all = pairs["headline_b"].tolist()
    y_all = pairs["label"].values.astype(np.int8)

    accs, aucs, vocab = [], [], []
    for tr_i, te_i in folds:
        vec, clf = _fit([a_all[i] for i in tr_i], [b_all[i] for i in tr_i],
                        y_all[tr_i], cfg)
        # Evaluate on the augmented test pairs so the comparison with the
        # hand-feature models is like for like.
        ea = [a_all[i] for i in te_i] + [b_all[i] for i in te_i]
        eb = [b_all[i] for i in te_i] + [a_all[i] for i in te_i]
        ey = np.concatenate([y_all[te_i], 1 - y_all[te_i]])
        pm = pairwise_metrics(ey, _prob(vec, clf, ea, eb))
        accs.append(pm.accuracy); aucs.append(pm.roc_auc)
        vocab.append(int(clf.coef_.shape[1]))

    vec, clf = _fit([a_all[i] for i in tr], [b_all[i] for i in tr], y_all[tr], cfg)
    ea = [a_all[i] for i in te] + [b_all[i] for i in te]
    eb = [b_all[i] for i in te] + [a_all[i] for i in te]
    ey = np.concatenate([y_all[te], 1 - y_all[te]])
    p = _prob(vec, clf, ea, eb)

    rep: Dict = {"pairwise": asdict(pairwise_metrics(ey, p))}
    rep.update(_selection_and_lift(vec, clf, arms, set(pairs.iloc[te]["test_id"])))
    # Antisymmetry is exact here for the same reason the baseline's is: no
    # intercept, and the difference is taken before the linear term. Measured
    # anyway rather than argued.
    rev = _prob(vec, clf, eb, ea)
    rep["antisymmetry_max_violation"] = float(np.max(np.abs(p + rev - 1.0)))
    rep["n_features"] = int(clf.coef_.shape[1])

    return {
        "model": "variant_tfidf_logreg",
        "note": ("Logistic regression on TF-IDF difference vectors. Same learner, "
                 "same augmentation and same splits as baseline_logreg, so the "
                 "margin isolates the feature representation."),
        "cv_group_split": {
            "cv_accuracy_mean": float(np.mean(accs)),
            "cv_accuracy_std": float(np.std(accs)),
            "cv_auc_mean": float(np.mean(aucs)),
            "cv_auc_std": float(np.std(aucs)),
            "n_folds": len(accs),
            "vocabulary_per_fold": vocab,
        },
        "temporal_holdout": rep,
    }
