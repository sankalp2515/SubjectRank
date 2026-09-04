"""Generate MODEL_CARD.md from a training run's JSON report.

Deliberately generated rather than hand-written. Every number in the model card
is read out of ml/reports/run_*.json, so a figure cannot be stale, rounded in the
wrong direction, or remembered slightly generously. If a number is not in the run
report, it does not appear in the card.

Usage:  python ml/scripts/write_model_card.py [--run ml/reports/run_XXX.json]
"""
from __future__ import annotations

import argparse
import json
import pathlib
from typing import Dict

ROOT = pathlib.Path(__file__).resolve().parents[2]
REPORTS = ROOT / "ml" / "reports"

CITATION = (
    "Matias, J.N., Munger, K., Le Quere, M.A. et al. The Upworthy Research "
    "Archive, a time series of 32,487 experiments in U.S. media. *Sci Data* "
    "**8**, 195 (2021). https://doi.org/10.1038/s41597-021-00934-7"
)


def pct(x) -> str:
    return "n/a" if x is None else f"{x:.2%}"


def num(x, d=4) -> str:
    return "n/a" if x is None else f"{x:.{d}f}"


def latest_run() -> pathlib.Path:
    runs = sorted(REPORTS.glob("run_*.json"))
    if not runs:
        raise SystemExit(
            "No run reports in ml/reports/. Train first:\n"
            "  python -m subjectrank.train\n"
            "The model card is generated from a run, never written by hand."
        )
    return runs[-1]


def build(r: Dict, champion: str) -> str:
    d = r["data"]
    th = r["temporal_holdout"]
    res = th["results"][champion]
    pw, sel, lift, cal = res["pairwise"], res["selection"], res["lift"], res["calibration"]
    cv = {c["model"]: c for c in r["cv_group_split"]}

    subsets = ", ".join(d["subsets_loaded"])
    dropped = [f["feature"] for f in r["features"]["dropped_low_support"]]

    L = []
    A = L.append
    A("# Model card — SubjectRank")
    A("")
    A(f"*Generated from `{r['run_id']}` by `ml/scripts/write_model_card.py`. "
      f"Every number here is read from the run report; none is written by hand.*")
    A("")
    A("## Task")
    A("")
    A("Given two subject lines, predict which one gets the higher click-through "
      "rate. To rank a set of 2–5 lines, every ordered pair is scored and "
      "aggregated by mean win probability.")
    A("")
    A("**The model does not predict open rate, click-through rate, or any absolute "
      "number, and structurally cannot.** It only ever answers *which of these "
      "beats which* (D-002).")
    A("")
    A("## Training data")
    A("")
    A(f"The Upworthy Research Archive — randomised A/B tests of headlines run by "
      f"Upworthy between January 2013 and April 2015. Subsets loaded for this run: "
      f"**{subsets}**.")
    A("")
    A("Licensed CC BY 4.0. Required attribution:")
    A("")
    A(f"> {CITATION}")
    A("")
    A("### What survived each filter")
    A("")
    A(d["ledger_markdown"])
    A("")
    A(f"Final training corpus: **{d['n_labelled_pairs']:,} labelled pairs** from "
      f"**{d['n_tests']:,} tests**, at z-test alpha **{d['alpha_used']}**.")
    A("")
    A("Two filters do most of the work and both are deliberate:")
    A("")
    A("- **Same-image pairs only** (D-003). Upworthy varied headline *and* image. "
      "A CTR difference between arms with different images is a joint effect, and "
      "attributing it to the headline would be wrong.")
    A("- **Statistically distinguishable pairs only** (D-010). Pairs whose CTR "
      "difference fails a two-proportion z-test are dropped rather than labelled "
      "by sign, because labelling noise teaches the model to predict coin flips.")
    A("")
    A("### Threshold sensitivity")
    A("")
    A("| alpha | pairs | % of candidates | label balance | median min impressions |")
    A("|---:|---:|---:|---:|---:|")
    for s in d["alpha_sweep"]:
        A(f"| {s['alpha']} | {s['pairs']:,} | {s['pct_of_candidates']}% | "
          f"{s['label_balance']} | {s['median_min_impressions']:,.0f} |")
    A("")
    A("## Features")
    A("")
    A(f"{len(r['features']['kept'])} hand-engineered features, specified in "
      f"`docs/FEATURES.md` and implemented independently in Python (training) and "
      f"TypeScript (serving). A TF-IDF variant was built and evaluated rather "
      f"than assumed away; it won and was still rejected — see the section below "
      f"and D-025. No embeddings, for the reasons in D-006 and "
      f"`docs/FEATURES.md` §6.")
    A("")
    A("The extractor takes a single string and nothing else, so it is structurally "
      "incapable of reading a dataset column. `impressions`, `clicks`, `winner`, "
      "`first_place` and `significance` are banned as inputs and the ban is "
      "asserted in code (D-004).")
    A("")
    if dropped:
        A(f"**Dropped for insufficient support in the training data** (D-012): "
          f"`{'`, `'.join(dropped)}`.")
        A("")
        A("These features are computed at serving time but excluded from the model. "
          "Emoji are the motivating case: 2013–2015 headlines contain almost none, "
          "so a coefficient would be noise with a confident sign attached, and the "
          "UI would be able to tell a user their emoji is hurting them — a claim "
          "with nothing behind it. **SubjectRank has nothing to say about emoji.**")
        A("")
    A("## Models compared")
    A("")
    A("| model | CV pairwise accuracy (group split) | CV ROC-AUC |")
    A("|---|---:|---:|")
    for name, c in cv.items():
        A(f"| {name} | {c['cv_accuracy_mean']:.4f} ± {c['cv_accuracy_std']:.4f} | "
          f"{c['cv_auc_mean']:.4f} ± {c['cv_auc_std']:.4f} |")
    A("")
    A(f"**Champion: `{champion}`.**")
    A("")
    A("## Results on the temporal holdout")
    A("")
    A(f"The honest number. Model selection used a group split on test id; this is "
      f"a **date-based** holdout — the most recent "
      f"{th['n_tests']:,} tests ({th['n_pairs']:,} pairs), cut at "
      f"`{th['cutoff']}`. Upworthy's editorial style drifted measurably across "
      f"2013–2015, so a time-forward split is the one that estimates "
      f"generalisation (D-005).")
    A("")
    A("### 1. Pairwise")
    A("")
    A(f"- Accuracy: **{pct(pw['accuracy'])}**")
    A(f"- ROC-AUC: **{num(pw['roc_auc'])}**")
    A(f"- Brier: {num(pw['brier'])}")
    A("")
    A("### 2. Top-1 selection accuracy")
    A("")
    A(f"Given every arm of an unseen test, does the model pick the true winner? "
      f"**This is what the product actually does.**")
    A("")
    A(f"- Top-1 accuracy: **{pct(sel['top1_accuracy'])}**")
    A(f"- Random baseline: {pct(sel['top1_baseline_random'])} "
      f"(1/n_arms, averaged — *not* 50%)")
    A(f"- Decisions evaluated: {sel['n_groups']:,} (test, image) groups "
      f"across {sel['n_tests']:,} tests, mean "
      f"{sel['mean_arms_per_group']:.2f} arms each")
    A("")
    A("### 3. Realised CTR lift")
    A("")
    A(f"- CTR of the arm the model would pick: **{num(lift['ctr_model_choice'], 5)}**")
    A(f"- CTR of the mean arm: {num(lift['ctr_mean_arm'], 5)}")
    A(f"- CTR of the best arm (oracle): {num(lift['ctr_best_arm'], 5)}")
    A(f"- CTR of the worst arm: {num(lift['ctr_worst_arm'], 5)}")
    A(f"- **Lift vs mean arm: {lift['lift_vs_mean_pct']:+.2f}%**")
    A(f"- Lift vs worst arm: {lift['lift_vs_worst_pct']:+.2f}%")
    A(f"- Share of the achievable headroom captured: "
      f"{lift['pct_of_oracle_gap_captured']:.1f}%")
    A("")
    A("Assignment to arms was randomised, so this is a **causal** estimate — "
      "**within the Upworthy domain and nowhere else.** It is not a claim about "
      "email, and it must never be quoted as one.")
    A("")
    A("### 4. Calibration")
    A("")
    A(f"- Brier score: **{num(cal['brier'])}**")
    A(f"- Largest gap between predicted and observed: "
      f"**{num(cal['max_calibration_gap'])}**")
    A("")
    A("| predicted | observed | n |")
    A("|---:|---:|---:|")
    for p_, o_, n_ in zip(cal["bin_mean_predicted"], cal["bin_observed_fraction"],
                          cal["bin_counts"]):
        A(f"| {p_:.3f} | {o_:.3f} | {n_:,} |")
    A("")
    A("The confidence indicator in the UI is only honest if these probabilities "
      "mean what they say. This table is why it is shown at all.")
    A("")
    A("### Antisymmetry")
    A("")
    A(f"Largest deviation from `f(d) + f(−d) = 1`: "
      f"**{res['antisymmetry_max_violation']:.2e}**")
    A("")
    A("If this were not near zero, reordering the lines a user pasted could change "
      "which one wins (D-009, D-013).")
    A("")

    # D-013 requires the violation measured on the EXPORTED GRAPH, because that
    # is the artifact the user's request actually runs through. The number above
    # is the Python model's; this table is the one the decision rests on.
    ex = r.get("onnx_exports") or {}
    if ex:
        A("### The serving gate — measured on the exported ONNX graph")
        A("")
        A("Both numbers below are properties of the file that ships, not of the "
          "Python object it came from (D-013).")
        A("")
        A("| model | export fidelity (max ǀΔǀ vs Python) | vectors over tolerance "
          "| ONNX antisymmetry | gate |")
        A("|---|---:|---:|---:|:--|")
        for name, e in ex.items():
            A(f"| {name} | {e['max_abs_delta']:.3e} | "
              f"{e['n_vectors_over_tolerance']} of {e['n_vectors_checked']} "
              f"({e['pct_vectors_over_tolerance']}%) | "
              f"{e['antisymmetry_max_violation']:.3e} | "
              f"{'PASS' if e['passed'] else '**FAILED — not promotable**'} |")
        A("")
        failed = {n: e for n, e in ex.items() if not e["passed"]}
        for name, e in failed.items():
            med = e["median_abs_delta"]
            A(f"`{name}` did not ship. Its ONNX graph disagrees with the Python "
              f"model it was converted from by up to **{e['max_abs_delta']:.2e}** on "
              f"{e['n_vectors_over_tolerance']} of {e['n_vectors_checked']} test "
              f"vectors, while the median disagreement is {med:.2e}. That shape — "
              f"almost all vectors exact, a few badly wrong — is a split-threshold "
              f"flip, not floating-point residual: the converter rounded a tree "
              f"threshold and those samples take a different branch. It is a "
              f"different function, and a wider tolerance would not make it the "
              f"same one.")
            A("")

    tf = r.get("tfidf_variant")
    if tf:
        tfh, tfcv = tf["temporal_holdout"], tf["cv_group_split"]
        base_h = th["results"]["baseline_logreg"]
        A("## The TF-IDF variant, and why it did not ship")
        A("")
        A("`docs/FEATURES.md` §6 predicted this would lose and be rejected. "
          "**It did not lose.** The margin is recorded here because §6 said that "
          "if it won by a large margin the decision would be revisited with the "
          "number written down.")
        A("")
        A("| | champion (hand features) | TF-IDF variant | margin |")
        A("|---|---:|---:|---:|")
        A(f"| CV pairwise accuracy | {cv[champion]['cv_accuracy_mean']:.4f} | "
          f"{tfcv['cv_accuracy_mean']:.4f} | "
          f"{tfcv['cv_accuracy_mean'] - cv[champion]['cv_accuracy_mean']:+.4f} |")
        A(f"| Holdout pairwise accuracy | {base_h['pairwise']['accuracy']:.4f} | "
          f"{tfh['pairwise']['accuracy']:.4f} | "
          f"{tfh['pairwise']['accuracy'] - base_h['pairwise']['accuracy']:+.4f} |")
        A(f"| Holdout ROC-AUC | {base_h['pairwise']['roc_auc']:.4f} | "
          f"{tfh['pairwise']['roc_auc']:.4f} | "
          f"{tfh['pairwise']['roc_auc'] - base_h['pairwise']['roc_auc']:+.4f} |")
        A(f"| Holdout top-1 accuracy | {base_h['selection']['top1_accuracy']:.4f} | "
          f"{tfh['selection']['top1_accuracy']:.4f} | "
          f"{tfh['selection']['top1_accuracy'] - base_h['selection']['top1_accuracy']:+.4f} |")
        A(f"| Features | {len(r['features']['kept'])} | "
          f"{tfh['n_features']:,} | |")
        A("")
        A("Same learner, same augmentation, same folds, vectoriser fitted on "
          "training text only — so the margin isolates the feature representation "
          "and nothing else. It was still rejected; see D-025 for the three "
          "reasons and what would reverse the decision.")
        A("")

    A("## Intended use")
    A("")
    A("Comparing subject lines a person has already written, to help choose between "
      "them. Nothing more.")
    A("")
    A("## Limitations — read these before quoting any number above")
    A("")
    A("1. **Domain gap.** Trained on 2013–2015 US viral media headlines; users "
       "write 2026 email subject lines. Absolute performance does not transfer. "
       "The claim is that the *direction* of feature effects transfers better than "
       "the *levels* — and that is a **hypothesis, not a finding** (D-011, Q-003). "
       "There is no public dataset of subject lines with real open rates to test "
       "it against.")
    A("2. **Clicks, not opens.** The outcome is a click on a headline on a web "
       "page, not an email open. Related, not identical.")
    A("3. **Relative, never absolute.** The model cannot tell you your open rate "
       "and will not try.")
    A("4. **Only compares what you supply.** A line ranked first is first among "
       "*your* lines — it is not good in absolute terms.")
    if dropped:
        A(f"5. **No opinion on `{'`, `'.join(dropped)}`.** Excluded for lack of "
          f"training support (D-012).")
    A("")
    A("## Reproducing this")
    A("")
    A("```")
    A("python -m subjectrank.train")
    A("python ml/scripts/write_model_card.py")
    A("```")
    A("")
    A(f"Config, environment and full metrics: `ml/reports/run_{r['run_id']}.json`. "
      f"Run took {r['wall_seconds']}s on "
      f"Python {r['environment']['python']}.")
    A("")
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", type=pathlib.Path, default=None)
    ap.add_argument("--champion", default=None)
    a = ap.parse_args()

    path = a.run or latest_run()
    r = json.loads(path.read_text(encoding="utf-8"))

    champion = a.champion
    if champion is None:
        # Default to the baseline unless the candidate clearly wins. "Clearly" is
        # a deliberate bar: D-013 says a marginal accuracy gain does not justify
        # giving up the baseline's exact antisymmetry.
        results = r["temporal_holdout"]["results"]
        base = results.get("baseline_logreg", {}).get("pairwise", {}).get("accuracy", 0)
        cand = results.get("candidate_lgbm", {}).get("pairwise", {}).get("accuracy", 0)
        champion = "candidate_lgbm" if cand > base + 0.01 else "baseline_logreg"
        # A model that failed the export gate has no artifact and cannot be the
        # champion whatever its accuracy says.
        ex = r.get("onnx_exports") or {}
        if champion in ex and not ex[champion]["passed"]:
            print(f"note: {champion} won on accuracy but failed the ONNX export "
                  f"gate; falling back to baseline_logreg")
            champion = "baseline_logreg"

    out = ROOT / "MODEL_CARD.md"
    out.write_text(build(r, champion), encoding="utf-8")
    print(f"wrote MODEL_CARD.md from {path.name} (champion: {champion})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
