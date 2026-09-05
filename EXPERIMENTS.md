# EXPERIMENTS

Every training run: run id, data version, hyperparameters, all four metrics,
promoted or not. **Including failures** — a run that went badly is evidence about
the problem, and deleting it makes the remaining runs look luckier than they were.

Entries are transcribed from `ml/reports/run_*.json`, never from memory. If a
number is not in a run report, it does not belong in this file.

---

## Pre-data verification (no model results)

Before the archive arrived, the pipeline was verified end-to-end on **synthetic**
data with a planted signal (shorter headlines and question marks given a higher
true CTR). This is a wiring check, not a result. None of these numbers describe
the real model and none may be quoted anywhere else.

| check | outcome |
|---|---|
| Feature parity, Python ↔ TypeScript | 178 strings × 52 features = 9,256 cells agree within 1e-9 |
| Parity suite mutation testing | 8 injected bugs, 8 caught |
| Python invariant tests | 926 passing |
| Pipeline smoke tests | 13 passing, incl. negative tests for leakage guard, count check, image-filter refusal |
| ONNX export fidelity — baseline | max abs delta 2.73e-07 vs Python (float32/float64 residual) |
| ONNX export fidelity — LightGBM | max abs delta 2.33e-07 vs Python |
| ONNX antisymmetry — baseline | 3.0e-08 |
| ONNX antisymmetry — LightGBM | 3.4e-01 |

The last two lines are the substantive finding of this stage and drove D-013: the
baseline is antisymmetric by construction, LightGBM only approximately so.

---

## Runs

Template for each run:

```
## run_YYYYMMDDTHHMMSSZ

Data:      subsets loaded, labelled pairs, tests, alpha
Model:     baseline_logreg | candidate_lgbm | candidate_lgbm_tfidf
Params:    (from run json "config")

Group-split CV:   pairwise acc, ROC-AUC
Temporal holdout: pairwise acc, ROC-AUC, top-1 acc (vs 1/n baseline),
                  realised CTR lift vs mean and vs worst, Brier,
                  max calibration gap, antisymmetry violation

Promoted:  yes / no
Why:       one paragraph, including what would have changed the decision
```

---

## run_20260828T121840Z — first run on real data, baseline promoted

Transcribed from `ml/reports/run_20260828T121840Z.json`. 313.5s, Python 3.12.0.

**Data.** Upworthy Research Archive, exploratory + confirmatory (D-014).
128,217 packages → **43,420 labelled pairs** from **11,279 tests**, z-test
alpha **0.10**. The archive's own hold-out subset was not loaded, and the audit
below confirms it.

**Params.** `logreg C=1.0, max_iter=2000, solver=lbfgs, fit_intercept=False`;
`lgbm n_estimators=400, lr=0.05, num_leaves=31, min_child_samples=50,
subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0`; 5 group folds;
`min_impressions_per_arm=100`; `max_pairs_per_test=40`; seed 20260826.

### Where the pairs went

| stage | remaining | removed |
|---|---:|---:|
| packages loaded | 128,217 | |
| image id present | 128,064 | 153 |
| arms after aggregation | 109,225 | 18,839 |
| arm impressions ≥ 100 | 109,175 | 50 |
| **candidate pairs (same test + same image, D-003)** | **115,566** | |
| non-tied CTR | 115,536 | 30 |
| **distinguishable at α=0.10 (D-010)** | **43,420** | 72,116 |

The D-003 cost is not in the "removed" column, it is in the group structure:
**45,556 of 60,554 (test, image) groups are singletons** and produce no pair at
all. The z-test then discards 62% of what survives.

### Alpha sweep

| alpha | pairs | % of candidates | label balance | median min impressions |
|---:|---:|---:|---:|---:|
| 0.05 | 34,053 | 29.47 | 0.5136 | 3,221 |
| **0.10** | **43,420** | **37.57** | **0.5121** | **3,189** |
| 0.20 | 56,229 | 48.66 | 0.5095 | 3,163 |
| 0.50 | 82,211 | 71.14 | 0.5078 | 3,113 |
| 1.00 | 115,536 | 99.97 | 0.5055 | 3,095 |

### Results

Group-split CV is model selection. The temporal holdout — the most recent
**2,256 tests / 8,999 pairs**, cut at `2014-11-12 00:33:09Z` — is the honest
number (D-005).

| | baseline_logreg | candidate_lgbm | variant_tfidf_logreg |
|---|---:|---:|---:|
| CV pairwise accuracy | **0.6138** ± 0.0018 | 0.6124 ± 0.0039 | 0.7321 ± 0.0102 |
| CV ROC-AUC | **0.6614** ± 0.0032 | 0.6590 ± 0.0034 | 0.8094 |
| Holdout pairwise accuracy | 0.5966 | **0.5973** | 0.6952 |
| Holdout ROC-AUC | **0.6458** | 0.6414 | 0.7653 |
| Holdout top-1 accuracy | 0.2829 | **0.2921** | 0.3625 |
| Holdout top-1 random baseline | 0.2259 | 0.2259 | 0.2259 |
| Realised CTR lift vs mean arm | +6.35% | **+7.04%** | +14.47% |
| Share of oracle gap captured | 14.02% | 15.55% | 31.96% |
| Brier | **0.2334** | 0.2349 | 0.2007 |
| Max calibration gap | **0.0259** | 0.0422 | — |
| Antisymmetry (Python model) | **0.000e+00** | 9.345e-02 | 2.220e-16 |
| **Antisymmetry (exported ONNX graph)** | **2.980e-08** | **1.349e-01** | not exported |
| **ONNX export fidelity** | **1.024e-07 — PASS** | **2.840e-02 — FAIL** | not exported |

Top-1 is 0.2829 against a 0.2259 random baseline over 2,287 (test, image) groups
averaging 4.80 arms. That is a **+25% relative** improvement on picking the true
winner, and it is a modest number. It was checked for leakage anyway.

### Leakage audit — `ml/scripts/audit_leakage.py`

Written to re-derive the properties from the data rather than trust the
pipeline's own guards, which were written by whoever wrote the pipeline. All ten
checks pass:

- No banned column appears in any feature name; `extract()` takes **one**
  positional argument (a string), so it is structurally incapable of reading a
  dataframe column; identical text yields an identical vector.
- GroupKFold: **0** shared `clickability_test_id` across folds, all 5 folds.
- Temporal holdout: **0** shared test ids, and **0 training pairs dated at or
  after the earliest holdout pair** — train max `2014-11-12 00:24:52Z`, holdout
  min `2014-11-12 00:33:09Z`.
- Holdout is 20.7% of pairs (configured 20% of *tests*).
- The archive's locked holdout subset was never loaded.
- Label balance 0.5121 before augmentation; the augmented half is the exact
  elementwise negation of the first.

**Headline-text overlap across split boundaries** — measured because TF-IDF can
memorise a repeated string where hand features cannot:

| split | distinct holdout headlines also in train | holdout pairs with both sides seen |
|---|---:|---:|
| temporal holdout | 35 of 8,582 (0.4%) | **1 of 8,999 (0.0%)** |
| group fold 0 | 1,202 of 8,836 (13.6%) | 232 of 8,684 (2.7%) |
| group fold 1 | 1,225 of 8,806 (13.9%) | 257 of 8,684 (3.0%) |

This explains the CV→holdout gaps. TF-IDF drops 3.7 points (0.7321 → 0.6952)
because the group split lets it memorise repeated text; the baseline drops 1.7
points (0.6138 → 0.5966) because it cannot memorise a string in the first place.
**The temporal holdout has essentially no text overlap, so TF-IDF's win there is
real and not memorisation.**

### Failures in this run

Both are recorded because deleting them would make the run look cleaner than it
was.

1. **`candidate_lgbm` failed the ONNX export gate.** Max delta 2.840e-02 against
   its own Python model, tolerance 1e-05. The delta distribution names the cause:
   median 1.957e-08 with **4 of 367 vectors over tolerance**. Almost every vector
   exact and a few badly wrong is a split-threshold flip — the converter rounded a
   tree threshold to float32 and those samples take a different branch. It is a
   different function, not a precision residual, and a wider tolerance would not
   make it the same one. No artifacts were written for it, so it is not
   promotable. See D-026.
2. **`variant_tfidf_logreg` won and was rejected anyway.** +0.0986 holdout
   pairwise, +0.1195 AUC, +0.0796 top-1 over the champion. `docs/FEATURES.md` §6
   predicted a small loss; it got a large win. Rejected on serving parity, domain
   transfer and attribution grounds — all three with numbers, in D-025.

### Promoted

**`baseline_logreg` → `web/model/champion.onnx`**, sha256 `703f3c08f18c9681…`,
version `baseline_logreg-20260828T121840Z`, 48 features, 4 excluded.

**Why.** LightGBM does not win clearly. It takes holdout pairwise by 0.0007 and
top-1 by 0.0092, and loses CV accuracy, CV AUC, holdout AUC, Brier and
calibration. Against that it carries an ONNX antisymmetry violation of
**1.349e-01** versus the baseline's **2.980e-08** — seven orders of magnitude —
and it cannot be exported faithfully at all. D-013 says a marginal accuracy gain
does not buy a correctness property the product visibly depends on. Here there is
no gain to weigh: it fails the gate outright.

**What would have changed the decision.** A LightGBM that exported faithfully and
won holdout top-1 by a margin large enough to be worth an order-of-magnitude
worse antisymmetry — and even then the tradeoff would have gone in the model card
with both numbers rather than being resolved quietly.

### Verified end to end after promotion

- Paste-order invariance through the live HTTP API: **24 permutations of 4 lines,
  0 order changes, largest score drift 0.000e+00** (`parity/order_invariance.mjs`).
  Not "within tolerance" — exactly zero, which is what `fit_intercept=False` plus
  `StandardScaler(with_mean=False)` buys.
- 966 Python tests, 9,568 parity cells at 1e-9, 9/9 mutations caught, lexicons
  clean, `next build` clean.

---

## run_20260902T210913Z — reproduction check, not promoted

Session 3 refactored the export path: the train-and-export loop moved out of
`ml/scripts/export_artifacts.py:main()` into `export_all()`, so the Azure ML job
(`azure/ml/entry.py`) could call the same function instead of carrying its own
copy. A refactor of the code that produces every number in `MODEL_CARD.md` is
worth re-running rather than reasoning about.

Re-run on identical data and config. **Every figure reproduced exactly:**

| | run_20260828T121840Z | run_20260902T210913Z |
|---|---:|---:|
| baseline CV accuracy | 0.6138 ± 0.0018 | 0.6138 ± 0.0018 |
| baseline holdout pairwise | 0.5966 | 0.5966 |
| baseline holdout AUC | 0.6458 | 0.6458 |
| baseline top-1 | 0.2829 | 0.2829 |
| baseline ONNX antisymmetry | 2.980e-08 | 2.980e-08 |
| baseline export fidelity | 1.024e-07 PASS | 1.024e-07 PASS |
| lgbm export fidelity | 2.840e-02 FAIL, 4/367 | 2.840e-02 FAIL, 4/367 |
| tfidf holdout pairwise | 0.6952 | 0.6952 |
| labelled pairs | 43,420 | 43,420 |

**Not promoted.** `web/model/champion.onnx` still holds
`baseline_logreg-20260828T121840Z`, which is the version `MODEL_CARD.md`
documents and the version the container image was verified against. The two runs
are byte-equivalent in every metric, so promoting the newer one would change a
version string and nothing else while making the model card stale. `ml/artifacts/`
now holds the newer export; running `ml/scripts/promote_model.py` would switch to
it, and the model card would need regenerating if it did.

**Failures:** the same one, and it is expected —`candidate_lgbm` refused by the
export gate (D-026). Recorded here because a run that fails identically to the
previous run is evidence the failure is deterministic rather than flaky.

---

## Azure ML run reproduced the local run to the precision the log prints — but not to the last bit

**Date:** 2026-09-05
**Runs:** `frank_window_n3y1clb1hk` (training verified), `gifted_net_l0tcftp3l3` (registered), `subjectrank-ml`, `Standard_DS3_v2`
**Compared against:** `ml/artifacts/baseline_logreg.meta.json` (local run `20260902T210913Z`)

Different machine, different OS, different CPU. Same pins, same input bytes.

**This entry was first written claiming the numbers were identical. They are
not, and the correction is the interesting part.** The job log prints four
significant figures, and at four significant figures everything matched — which
is exactly how a reproducibility claim gets overstated. The registered model's
tags carry full precision, and they disagree:

| | local | Azure | |
|---|---|---|---|
| ONNX antisymmetry violation | `2.9802322387695312e-08` | `2.9802322387695312e-08` | **exactly equal** |
| export fidelity max abs delta | `1.0238653014305044e-07` | `1.0238639880366662e-07` | **differ**, 1.28e-06 relative |
| ONNX graph sha256 | `d2f9b8f6…` | `9fe45313…` | **differ** |
| vectors over tolerance | 0 of 367 | 0 of 367 | equal |
| graph size | 2,427 bytes | 2,427 bytes | equal |

### What is actually true

The fitted coefficients differ in their last bits, so the exported graphs are not
byte-identical, and the export-fidelity delta measured against them differs at
the 8th significant figure. This is ordinary cross-platform floating-point
nondeterminism — a different BLAS, a different CPU, different summation order in
the same LogisticRegression solve.

The antisymmetry violation matches exactly because it is a float32
representation artifact (`2.98e-08` is ~`2^-25`), not an accumulation of the fit.

**What this does support.** The pipeline is reproducible in every way that
affects a decision: the same filter ledger, the same 43,420 labelled pairs, the
same holdout split, the same accuracy to reported precision, the same gate
outcomes, and `candidate_lgbm` refused on both sides for the same reason. The
pins in `ml/requirements.txt` hold across machines — which is what D-026 needed,
since the LightGBM export-fidelity number moves with the converter version.

**What it does not support.** Bit-level determinism. If a future claim needs
byte-identical artifacts across machines — a reproducible-build argument, or
caching a graph by hash across environments — this measurement says that does not
hold today, and pinning versions alone will not make it hold.

**Does the difference matter to a user?** No. A ~1e-13 relative difference in
coefficients cannot reorder two lines unless their aggregate scores are already
equal to within that, and pairs that close are reported as a tie by
`TOO_CLOSE_THRESHOLD` long before this matters. It is recorded because it is
true, not because it is consequential.

### The rest of the run, for the record

```
packages loaded              128,217
image id present             128,064   (-153, D-003 filter)
arms after aggregation       109,225   (-18,839)
candidate pairs              115,566   45,556 of 60,554 groups were singletons; 28 capped at 40
distinguishable at alpha=0.1  43,420   (-72,116 dropped as noise, two-proportion z-test)

baseline_logreg   CV acc 0.6138 +/- 0.0018  AUC 0.6614
candidate_lgbm    CV acc 0.6124 +/- 0.0039  AUC 0.6590

temporal holdout: 8,999 pairs from 2,256 tests on/after 2014-11-12

baseline_logreg   pairwise 0.5966  AUC 0.6458  top-1 0.2829 vs random 0.2259  antisym 2.22e-16
candidate_lgbm    pairwise 0.5973  AUC 0.6414  top-1 0.2921 vs random 0.2259  antisym 9.34e-02
variant_tfidf     CV 0.7321        holdout pairwise 0.6952  AUC 0.7653  top-1 0.3625  162,594 features
```

`candidate_lgbm` was refused on Azure for the same reason it was refused locally:
export fidelity `2.840e-02` against a `1.0e-05` tolerance, 4 of 367 vectors over,
and an ONNX antisymmetry violation of `1.349e-01`. The gate is in
`subjectrank.promotion` and both paths call it, which is the point of D-029 — the
registry path and the local path could not disagree about this even if someone
wanted them to.

### Why this is worth writing down

`conda_train.yml` installs from `ml/requirements.txt` alone, so the Azure run and
the local run cannot drift apart on converter versions. This is the evidence that
arrangement works.

**What it does not show.** Same data, same seed, same versions — so it is a test
of determinism, not of generalisation. It says nothing about whether the model is
any good, which is what the temporal holdout is for and where the honest number
is `top-1 0.2829 against a 0.2259 random baseline`.

**And the meta-lesson.** The first version of this entry said "Not 'close' — the
same numbers", on the strength of a log that rounds to four significant figures.
The full-precision values were available the moment the model registered its
tags. A reproducibility claim is only as strong as the precision it was checked
at, and checking at the precision that happens to be printed is how you end up
asserting something false while looking rigorous.

---

## D-031 measured: the assumption behind D-006 does not survive contact

**Date:** 2026-09-05
**Run:** `azure/bench/results/bench_2026-09-05T07-45-58-117Z.json`
**Load:** 120 requests per target, concurrency 4, 4 lines per request. **0 errors in 360 requests.**

| target | what it is | first request | warm p50 | warm p90 | warm p99 |
|---|---|---|---|---|---|
| `aca` | Next.js, ONNX in-process (D-006's choice) | 34,089 ms | **17.25 ms** | 79.40 ms | 100.17 ms |
| `api` | FastAPI, separate Python service | 28,776 ms | **16.24 ms** | **25.94 ms** | **45.28 ms** |
| `amlep` | AML managed online endpoint | 62.6 ms | 18.14 ms | 26.88 ms | 71.86 ms |

### The first-request column is not a cold-start comparison

`aca` and `api` run at `minReplicas: 0` and had been idle, so their first request is a
genuine cold start. `amlep` runs `instance_count: 1` — always on, always billing —
so its 62.6 ms is a warm request wearing a cold request's position in the table.
Reading those three numbers as one measurement would be exactly the quiet
overstatement this harness was built to avoid, which is why it records what was
actually done rather than labelling the column "cold start".

### What D-006 assumed, and what is true

D-006 chose in-process ONNX over "a separate Python inference service" on
cold-start and cost grounds — reasoning, never measured. Now measured:

* **Warm median is a wash.** 17.25 ms against 16.24 ms. The forward pass is not
  where the time goes; a 48-feature logistic regression over at most 20 pairs is
  microseconds of arithmetic. Both numbers are dominated by HTTP and process
  overhead.
* **The separate service has the better tail, by a lot.** p90 **25.94 ms vs
  79.40 ms**, p99 **45.28 ms vs 100.17 ms** — roughly three times better at p90.
  The in-process path is the one with the ragged tail, which is the opposite of
  what D-006 predicted.
* **Cold start does not separate them either.** 28.8 s against 34.1 s, both
  dominated by container start, not by which language runs the graph.

### The honest conclusion

**The latency argument in D-006 is not supported.** What the in-process design
actually buys is a smaller operational surface — one host, one deploy, and no
second implementation of feature extraction to keep in step. That is a real
benefit and it is the one to cite; it is not a speed benefit.

This does not reverse D-006, because the frontend still runs extraction and
attribution locally in both modes (D-035) and the parity gates now cover the
second surface. It does mean the *reason recorded* for D-006 was wrong, and the
right reason is operational rather than performance.

### Cost, and the reason this endpoint no longer exists

The managed endpoint bills a dedicated instance continuously whether or not
anyone calls it. It was created, measured and **deleted in the same sequence**.
An earlier attempt left it running, which cost roughly nine hours of billing for
a deployment that could not serve a single request — see Q-014.
