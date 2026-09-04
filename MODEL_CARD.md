# Model card — SubjectRank

*Generated from `20260828T121840Z` by `ml/scripts/write_model_card.py`. Every number here is read from the run report; none is written by hand.*

## Task

Given two subject lines, predict which one gets the higher click-through rate. To rank a set of 2–5 lines, every ordered pair is scored and aggregated by mean win probability.

**The model does not predict open rate, click-through rate, or any absolute number, and structurally cannot.** It only ever answers *which of these beats which* (D-002).

## Training data

The Upworthy Research Archive — randomised A/B tests of headlines run by Upworthy between January 2013 and April 2015. Subsets loaded for this run: **confirmatory, exploratory**.

Licensed CC BY 4.0. Required attribution:

> Matias, J.N., Munger, K., Le Quere, M.A. et al. The Upworthy Research Archive, a time series of 32,487 experiments in U.S. media. *Sci Data* **8**, 195 (2021). https://doi.org/10.1038/s41597-021-00934-7

### What survived each filter

| stage | remaining | removed | note |
|---|---:|---:|---|
| packages loaded | 128,217 |  | raw rows across all loaded subsets |
| headline present | 128,217 | 0 | dropped null/blank headlines |
| outcomes valid | 128,217 | 0 | impressions > 0, 0 <= clicks <= impressions |
| image id present | 128,064 | 153 | needed for the D-003 filter |
| arms after aggregation | 109,225 | 18,839 | summed duplicate rows within (test, image, headline) |
| arm impressions >= threshold | 109,175 | 50 | min_impressions_per_arm = 100 |
| candidate pairs | 115,566 | -6,391 | within (test, image); 45,556 of 60,554 groups were singletons; 28 groups capped at 40 |
| distinct headlines | 115,566 | 0 | identical text in both arms carries no headline signal |
| non-tied CTR | 115,536 | 30 | dropped 30 exact CTR ties |
| distinguishable at alpha=0.1 | 43,420 | 72,116 | two-proportion z-test; dropped 72,116 as noise |

Final training corpus: **43,420 labelled pairs** from **11,279 tests**, at z-test alpha **0.1**.

Two filters do most of the work and both are deliberate:

- **Same-image pairs only** (D-003). Upworthy varied headline *and* image. A CTR difference between arms with different images is a joint effect, and attributing it to the headline would be wrong.
- **Statistically distinguishable pairs only** (D-010). Pairs whose CTR difference fails a two-proportion z-test are dropped rather than labelled by sign, because labelling noise teaches the model to predict coin flips.

### Threshold sensitivity

| alpha | pairs | % of candidates | label balance | median min impressions |
|---:|---:|---:|---:|---:|
| 0.05 | 34,053 | 29.47% | 0.5136 | 3,221 |
| 0.1 | 43,420 | 37.57% | 0.5121 | 3,189 |
| 0.2 | 56,229 | 48.66% | 0.5095 | 3,163 |
| 0.5 | 82,211 | 71.14% | 0.5078 | 3,113 |
| 1.0 | 115,536 | 99.97% | 0.5055 | 3,095 |

## Features

48 hand-engineered features, specified in `docs/FEATURES.md` and implemented independently in Python (training) and TypeScript (serving). A TF-IDF variant was built and evaluated rather than assumed away; it won and was still rejected — see the section below and D-025. No embeddings, for the reasons in D-006 and `docs/FEATURES.md` §6.

The extractor takes a single string and nothing else, so it is structurally incapable of reading a dataset column. `impressions`, `clicks`, `winner`, `first_place` and `significance` are banned as inputs and the ban is asserted in code (D-004).

**Dropped for insufficient support in the training data** (D-012): `emoji_leading`, `has_emoji`, `emoji_count`, `emoji_trailing`.

These features are computed at serving time but excluded from the model. Emoji are the motivating case: 2013–2015 headlines contain almost none, so a coefficient would be noise with a confident sign attached, and the UI would be able to tell a user their emoji is hurting them — a claim with nothing behind it. **SubjectRank has nothing to say about emoji.**

## Models compared

| model | CV pairwise accuracy (group split) | CV ROC-AUC |
|---|---:|---:|
| baseline_logreg | 0.6138 ± 0.0018 | 0.6614 ± 0.0032 |
| candidate_lgbm | 0.6124 ± 0.0039 | 0.6590 ± 0.0034 |

**Champion: `baseline_logreg`.**

## Results on the temporal holdout

The honest number. Model selection used a group split on test id; this is a **date-based** holdout — the most recent 2,256 tests (8,999 pairs), cut at `2014-11-12 00:33:09.493000+00:00`. Upworthy's editorial style drifted measurably across 2013–2015, so a time-forward split is the one that estimates generalisation (D-005).

### 1. Pairwise

- Accuracy: **59.66%**
- ROC-AUC: **0.6458**
- Brier: 0.2334

### 2. Top-1 selection accuracy

Given every arm of an unseen test, does the model pick the true winner? **This is what the product actually does.**

- Top-1 accuracy: **28.29%**
- Random baseline: 22.59% (1/n_arms, averaged — *not* 50%)
- Decisions evaluated: 2,287 (test, image) groups across 2,256 tests, mean 4.80 arms each

### 3. Realised CTR lift

- CTR of the arm the model would pick: **0.01030**
- CTR of the mean arm: 0.00969
- CTR of the best arm (oracle): 0.01408
- CTR of the worst arm: 0.00595
- **Lift vs mean arm: +6.35%**
- Lift vs worst arm: +73.09%
- Share of the achievable headroom captured: 14.0%

Assignment to arms was randomised, so this is a **causal** estimate — **within the Upworthy domain and nowhere else.** It is not a claim about email, and it must never be quoted as one.

### 4. Calibration

- Brier score: **0.2334**
- Largest gap between predicted and observed: **0.0259**

| predicted | observed | n |
|---:|---:|---:|
| 0.245 | 0.263 | 22 |
| 0.345 | 0.371 | 322 |
| 0.400 | 0.406 | 1,274 |
| 0.444 | 0.470 | 2,857 |
| 0.483 | 0.507 | 4,521 |
| 0.517 | 0.492 | 4,527 |
| 0.556 | 0.530 | 2,857 |
| 0.600 | 0.594 | 1,274 |
| 0.655 | 0.629 | 322 |
| 0.755 | 0.737 | 22 |

The confidence indicator in the UI is only honest if these probabilities mean what they say. This table is why it is shown at all.

### Antisymmetry

Largest deviation from `f(d) + f(−d) = 1`: **0.00e+00**

If this were not near zero, reordering the lines a user pasted could change which one wins (D-009, D-013).

### The serving gate — measured on the exported ONNX graph

Both numbers below are properties of the file that ships, not of the Python object it came from (D-013).

| model | export fidelity (max ǀΔǀ vs Python) | vectors over tolerance | ONNX antisymmetry | gate |
|---|---:|---:|---:|:--|
| baseline_logreg | 1.024e-07 | 0 of 367 (0.0%) | 2.980e-08 | PASS |
| candidate_lgbm | 2.840e-02 | 4 of 367 (1.0899%) | 1.349e-01 | **FAILED — not promotable** |

`candidate_lgbm` did not ship. Its ONNX graph disagrees with the Python model it was converted from by up to **2.84e-02** on 4 of 367 test vectors, while the median disagreement is 1.96e-08. That shape — almost all vectors exact, a few badly wrong — is a split-threshold flip, not floating-point residual: the converter rounded a tree threshold and those samples take a different branch. It is a different function, and a wider tolerance would not make it the same one.

## The TF-IDF variant, and why it did not ship

`docs/FEATURES.md` §6 predicted this would lose and be rejected. **It did not lose.** The margin is recorded here because §6 said that if it won by a large margin the decision would be revisited with the number written down.

| | champion (hand features) | TF-IDF variant | margin |
|---|---:|---:|---:|
| CV pairwise accuracy | 0.6138 | 0.7321 | +0.1183 |
| Holdout pairwise accuracy | 0.5966 | 0.6952 | +0.0986 |
| Holdout ROC-AUC | 0.6458 | 0.7653 | +0.1195 |
| Holdout top-1 accuracy | 0.2829 | 0.3625 | +0.0796 |
| Features | 48 | 162,594 | |

Same learner, same augmentation, same folds, vectoriser fitted on training text only — so the margin isolates the feature representation and nothing else. It was still rejected; see D-025 for the three reasons and what would reverse the decision.

## Intended use

Comparing subject lines a person has already written, to help choose between them. Nothing more.

## Limitations — read these before quoting any number above

1. **Domain gap.** Trained on 2013–2015 US viral media headlines; users write 2026 email subject lines. Absolute performance does not transfer. The claim is that the *direction* of feature effects transfers better than the *levels* — and that is a **hypothesis, not a finding** (D-011, Q-003). There is no public dataset of subject lines with real open rates to test it against.
2. **Clicks, not opens.** The outcome is a click on a headline on a web page, not an email open. Related, not identical.
3. **Relative, never absolute.** The model cannot tell you your open rate and will not try.
4. **Only compares what you supply.** A line ranked first is first among *your* lines — it is not good in absolute terms.
5. **No opinion on `emoji_leading`, `has_emoji`, `emoji_count`, `emoji_trailing`.** Excluded for lack of training support (D-012).

## Reproducing this

```
python -m subjectrank.train
python ml/scripts/write_model_card.py
```

Config, environment and full metrics: `ml/reports/run_20260828T121840Z.json`. Run took 313.5s on Python 3.12.0.
