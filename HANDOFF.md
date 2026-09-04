# HANDOFF — sessions 2 to 4

Read `OPEN_QUESTIONS.md` first, then this.

---

## The one-line status

**It is deployed and running on Azure, and both serving paths agree.** Nine gates
pass. The frontend redesign is in. FastAPI serves inference as a second container
app, and the Next frontend can delegate to it, which is what makes a Vercel
deployment possible.

Live right now:

| | url | checked |
|---|---|---|
| web | `subjectrank-web.lemonwater-da4e206e.centralindia.azurecontainerapps.io` | `/api/health` 200; order-invariance **0 drift over 24 permutations** |
| api | `subjectrank-api.lemonwater-da4e206e.centralindia.azurecontainerapps.io` | `/v1/health` 200 in **266 ms** |

**Still not done:** Vercel itself is configured but not deployed (that needs your
account), the Azure ML training job has not yet finished a successful run, and
the D-031 endpoint benchmark has not been measured. The clause audit at the
bottom is stale for anything it claims about deployment — treat this table as
current and that section as history.

## What changed in session 4 (FastAPI, Vercel, and Azure for real)

**The infrastructure actually ran this time**, and six separate things had to be
fixed to get there. `D-033` lists them; the one worth knowing is that the
container app sat `InProgress` with zero revisions because a system-assigned
identity cannot be granted `AcrPull` before the app exists, and the app cannot
finish being created until it can pull. The identity is user-assigned now and
created in the infra pass.

**FastAPI serves inference** (`api/`), reusing `subjectrank.features` directly
rather than reimplementing extraction. `SUBJECTRANK_API_URL` switches the Next
app between running the ONNX graph in-process and delegating that one step over
HTTP — everything else, including all of the reasoning, still runs in the Next
process either way (`D-035`).

**Two new gates**, because two serving paths now exist:

* `parity/serving_parity.mjs` — Next vs FastAPI agree on order and tie flags.
  **5 cases, both live on Azure, identical.**
* `parity/inference_mode_parity.mjs` — the same frontend, fed probabilities
  locally and over HTTP, must produce identical scores, tie flags, reasoning
  sentences and highlight offsets. **7 cases, largest score delta 0.000e+0.**
  Mutation-tested: a 1e-15 score perturbation, a reworded reason and a
  one-character mark shift were each injected and each caught.

**One real UI bug, found by looking.** The verdict says *"B comes first"* and the
redesigned list had dropped the A/B/C letters, so nothing on the page said which
line B was — rows are in rank order, the input is in paste order. Restored. The
CSS rule for it also used `var(--bg-subtle)`, which does not exist; `globals.css`
is now audited so every token it references is defined.

**`Q-012` opened.** Across seven comparison cases the interface produced only
three highlights, and a line built specifically to trigger them (leading digit,
two ALL-CAPS words) produced none. The mechanism is consistent — length-based
reasons have no span to point at — but "reasoning traceable to the exact
characters" may describe its best case rather than its usual one. Not papered
over, not silently fixed.

## What changed in session 3 (Azure)

| piece | before | now |
|---|---|---|
| Deploy target | none | `web/Dockerfile` → Container Apps, **image built and verified locally** |
| Image size | — | 833 MB → **523 MB** (216 MB of it was macOS/Windows ONNX binaries a Linux container cannot run) |
| Readiness | none | `/api/health` loads the ONNX session and reports the live model's sha256 |
| Infrastructure | none | `azure/infra/main.bicep` — ACR, Container Apps, Blob, Log Analytics, App Insights, Azure ML |
| Training lineage | local script | `azure/ml/entry.py` — same pipeline, MLflow metrics, model registry |
| Promotion | `shutil.copy2` | registry alias, via `subjectrank.promotion` shared with the local path |
| Archive provenance | one laptop | `ml/scripts/upload_archive.py` — sha256 + record counts per file |
| CI | none | `.github/workflows/gates.yml` (7 gates) and `deploy.yml` |
| D-006 assumption | unmeasured since session 1 | harness built; in-process half measured, Azure half not (Q-011) |

## What changed in session 2 (the model)

| piece | before | now |
|---|---|---|
| Training run on real data | blocked | **done** — `run_20260828T121840Z` |
| Champion | none | `baseline_logreg`, promoted, sha256 `703f3c08f18c9681…` |
| `MODEL_CARD.md` | refused to generate | generated from the run report |
| TF-IDF variant | asserted rejected in §6 | **built, evaluated, still rejected — with the margin** (D-025) |
| ONNX export | function existed, nothing called it | `ml/scripts/export_artifacts.py` |
| Worked example | `status: untrained` | real ranking from the promoted graph |
| Outcome reporting UI | not built | built (`components/ReportOutcome.tsx`) |
| Account upgrade UI | not built | built (`KeepWork`, post-result only) |
| Funnel events | 5 of 11 fired | all 11 fired |
| `ml/requirements.txt` | did not exist | pinned to the versions that produced the run |

## The result, in one table

Temporal holdout — most recent 2,256 tests, cut at `2014-11-12 00:33:09Z`.

| | baseline (shipped) | lgbm | tfidf |
|---|---:|---:|---:|
| pairwise accuracy | 0.5966 | 0.5973 | 0.6952 |
| ROC-AUC | 0.6458 | 0.6414 | 0.7653 |
| top-1 (vs 0.2259 random) | 0.2829 | 0.2921 | 0.3625 |
| CTR lift vs mean arm | +6.35% | +7.04% | +14.47% |
| ONNX antisymmetry | **2.98e-08** | 1.35e-01 | — |
| ONNX export fidelity | **PASS** | **FAIL 2.84e-02** | — |

Full numbers, the filter ledger and the alpha sweep are in `EXPERIMENTS.md`.

**Top-1 0.2829 against a 0.2259 baseline is +25% relative and it is a modest
number.** It was checked for leakage anyway — `ml/scripts/audit_leakage.py`,
ten checks, all passing, re-derived from the data rather than trusting the
pipeline's own guards. The temporal boundary is clean to the minute: train max
`00:24:52`, holdout min `00:33:09`, zero training pairs at or after it.

## The two things worth arguing about

**1. TF-IDF won by ten points and did not ship (D-025).** `docs/FEATURES.md` §6
predicted it would lose; it beat the champion by +0.0986 holdout pairwise,
+0.1195 AUC and +0.0796 top-1. The win is not memorisation — the temporal holdout
shares 0.4% of its headlines with training and exactly **1 of 8,999 pairs** has
both sides seen. It was rejected on serving parity, domain transfer and
attribution, all three written down with numbers. **Expect to be asked about
this, and do not describe the champion as "the best model" — it is the best
deployable one, which is a different sentence.**

**2. LightGBM failed the export gate outright (D-026).** Max delta 2.84e-02
against its own Python model, with a median of 1.96e-08 and 4 of 367 vectors over
tolerance — the signature of a split-threshold flip, not float residual. D-013
asked whether a marginal accuracy gain justifies losing antisymmetry; the
question does not arise, because there is no faithful graph to weigh.

## Bugs found by looking at the rendered page, not by reading code

Fourth session running that this is where the real bugs came from.

1. **`more ft determiner than the others`** rendered under a subject line. Eight
   features had no plain-language phrase and the fallback printed the internal
   name at the reader (D-028). Now fixed, and `parity/phrases_check.ts` fails the
   build if it recurs — verified by injecting the bug and watching it fail.
2. **The landing page crashed during prerender.** The worked example JSON carried
   no `notes`/`marks`, so the ranking would have rendered with no reasoning at
   all. Attribution is now derived from the same TypeScript the live path uses
   (D-027).
3. **`build_worked_example.py` read a path nothing creates.** It looked in
   `ml/artifacts/champion.*`; promotion writes `web/model/champion.*`. It always
   took the "untrained" branch, so the page kept showing the no-model notice after
   a successful promotion.
4. **`selection.n_tests` counted (test, image) groups, not tests** — reporting
   2,287 "tests" for a holdout containing 2,256. Both are now reported under their
   own names.
5. **The placing gutter collapsed** "1st" and its letter onto one line after a
   sticky-positioning change.
6. **The tie verdict counted instead of naming.** With one clear winner and two
   inseparable lines below it, the sentence read *"Below that, some of the 2
   others are too close to separate"* — making the reader work out which two, in
   the one sentence whose whole job is to say exactly what the model knows. It
   now reads *"C comes first. Below that, nothing separates A and B."*

## Verified end to end

- **Paste-order invariance through the live HTTP API**: 24 permutations of 4
  lines, 0 order changes, largest score drift **0.000e+00**. Not "within
  tolerance" — exactly zero. `node parity/order_invariance.mjs` with the app
  running.
- Full flow driven through the real API at 1440px and 375px: paste → Compare →
  ranking → trace a reason → outcome form. `document.scrollWidth` equals the
  viewport at both widths, zero elements outside it, zero console errors.
- The tie state exercised against the real model, not a fixture: three lines
  scoring 0.5759 / 0.4790 / 0.4451 render as `1st` · `2nd–3rd` · `2nd–3rd` with
  the tie strip drawn between the two inseparable blocks.
- **The production container image**, built and run locally: healthy in 2s,
  serving `baseline_logreg-20260828T121840Z` with a matching sha256, and holding
  paste-order invariance through the container at 0.000e+00 drift.
- 977 Python tests · 9,568 parity cells at 1e-9 · 9/9 mutations caught ·
  phrases check clean · lexicons clean · `next build` clean.

## What needs you

1. **Q-001 is settled in `DECISIONS.md` but the launch copy is not reconciled.**
   The number is **27,616 tests** trained on, out of an archive of 32,487. Every
   `32,487` in draft copy that describes *training* is wrong; the citation itself
   correctly keeps 32,487 because that is the paper's title.
2. **Q-007** — three correlated length features shown as three reasons with
   opposite signs. True, and predictably misread. Needs a call.
3. **Q-008** — "I sent something else" is in the design and impossible in the
   schema. One migration.
4. **An Azure subscription.** Everything in `azure/` is written and syntax-checked
   but has never touched a real subscription. `azure/README.md` is the runbook;
   read its cost section first — the benchmark endpoint is the one resource that
   bills while idle.
5. **Q-011** — the D-006 benchmark has one column. The in-process path measures
   45.45 ms p50; there is no Azure column yet and the report refuses to pretend
   otherwise.
6. Deploy, if you want the remaining §14 clauses to become true.

## What I'd do next, in order

1. Reconcile the launch kit against `MODEL_CARD.md` — every bracketed token.
2. Q-007, because it is the most likely thing a careful visitor notices.
3. Deploy. Nothing after this point can be learned locally: no users means no
   funnel, no drift, no reported outcomes, and no test of D-011.
4. Once outcomes exist, re-run the TF-IDF comparison against them. If TF-IDF's
   advantage survives the domain gap, D-025 reverses and that is the most
   interesting result this project could produce.

---

## §14's sentence, clause by clause

> I trained a pairwise ranking model on 32,487 randomized headline experiments,
> deployed it as ONNX inference on serverless with a training/serving parity test
> suite, shipped it to real users, instrumented the funnel, detected the
> distribution shift between my training data and real usage, and built the
> champion/challenger retraining path to close it.

| clause | true? |
|---|---|
| trained a pairwise ranking model | **Yes.** `run_20260828T121840Z`. |
| on 32,487 randomized headline experiments | **No — the number is wrong.** Trained on **27,616** tests (exploratory + confirmatory); the archive holds 32,487 and its hold-out subset was never loaded (D-014). |
| deployed it as ONNX inference on serverless | **Still no, but closer.** The container image is built and verified, the Container Apps infrastructure and CI exist as code, and the deploy pipeline verifies the live sha256. None of it has run against a subscription. Container Apps is also containers-on-serverless-infrastructure rather than a function — if this ships, say "Azure Container Apps", not "serverless". |
| with a training/serving parity test suite | **Yes.** 9,568 cells at 1e-9, mutation-tested 9/9. |
| shipped it to real users | **No.** |
| instrumented the funnel | **Partly.** All 11 events fire and are recorded; with no users there is no funnel. |
| detected the distribution shift between my training data and real usage | **No.** The detector is written and unit-tested. Nothing has been detected because there is no real usage. |
| built the champion/challenger retraining path | **Yes**, and it was exercised for real this session — the challenger was rejected by the gate rather than by hand. |

**Three of eight clauses are true.** The honest version, with the false clauses
deleted rather than softened:

> I trained a pairwise ranking model on 27,616 randomised headline experiments,
> exported it to ONNX behind a training/serving parity test suite, and built a
> champion/challenger promotion path that refused my stronger candidate on a
> serving-correctness gate.

Every word of that is currently true. The rest becomes true on deploy, and not
before.

**One more sentence that is true and worth having**, because it is the part
interviewers actually probe:

> The best model I built was ten points better and I did not ship it, for three
> reasons I wrote down with numbers attached.
