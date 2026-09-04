# SubjectRank

Paste two to five email subject lines. Get them ranked against each other, with the
reasoning marked on the text itself.

> **Status: the model is not trained.** The Upworthy Research Archive is downloaded
> by hand (see `docs/GET_THE_DATA.md` and D-001) and had not landed when this was
> written. Everything else is built and tested. Every `[BRACKETED]` value below is a
> placeholder that gets filled from `MODEL_CARD.md` after the first training run —
> if a number is not in the model card, it does not belong here.

---

## What it does

It answers *which of these wins*, and nothing else.

It does **not** predict your open rate. Not "we chose not to" — it is a pairwise
model and is structurally incapable of producing an absolute number (D-002). Every
tool that hands you a confident score out of 100 is predicting a metric that Apple
Mail Privacy Protection made substantially less trustworthy, using a model nobody
will describe.

## What it was trained on, and why that is strange

There is no public dataset of email subject lines with real open rates. This was
checked properly: the academic work on subject-line prediction uses proprietary
corpora that were never released, and the "email campaign" datasets on Kaggle and
Hugging Face are mock, synthetic, or unlabelled.

So the training data is the **Upworthy Research Archive** — [N_EXPERIMENTS]
randomised A/B tests of headlines run between January 2013 and April 2015, released
CC BY 4.0 alongside a Nature Scientific Data paper.

It is a proxy, and in three ways it is a better one than a subject-line corpus would
have been: assignment was randomised, so effects are causal rather than
observational; the outcome is a click rather than a pixel-tracked open; and the
within-test structure gives clean pairwise contrasts for free.

> Matias, J.N., Munger, K., Le Quere, M.A. et al. The Upworthy Research Archive, a
> time series of 32,487 experiments in U.S. media. *Sci Data* **8**, 195 (2021).
> <https://doi.org/10.1038/s41597-021-00934-7>

**The domain gap is the headline limitation, not a footnote.** The model learned
from 2013–2015 US viral media headlines; you are writing 2026 email subject lines.
Absolute performance does not transfer. The claim is that the *direction* of feature
effects transfers better than the *levels* — and that is a **hypothesis, not a
finding** (D-011, Q-003). It is why the tool ranks instead of scoring, it is stated
on the landing page, and the user-reported outcome flow exists to start testing it.

## Results

Filled from `MODEL_CARD.md`, which is generated from a run report and refuses to be
written by hand.

| metric | value |
|---|---|
| Top-1 selection accuracy (temporal holdout) | `[TOP1_ACC]` vs `[TOP1_BASELINE]` random |
| Pairwise accuracy / ROC-AUC | `[PAIRWISE_ACC]` / `[AUC]` |
| Realised CTR lift vs the mean arm | `[LIFT_PCT]` |
| Brier score | `[BRIER]` |

Top-1 leads because it is what the product actually does. The random baseline is
`1/n_arms`, not 50%.

## Three decisions worth reading

Full reasoning for all thirteen is in `DECISIONS.md`.

**Same-image pairs only** (D-003). Upworthy varied headline *and* image in the same
test. A CTR difference between arms with different images is a joint effect, and
attributing it to the headline is simply wrong. The filter costs most of the data.
The surviving count is in the model card.

**The extractor takes one string and nothing else** (D-004). Impressions are the
famous trap in this dataset: arms accumulated them as the test ran and editors
stopped tests once a winner emerged, so impressions encode the outcome *and its own
stopping rule*. Rather than remembering not to use them, the extractor is
structurally unable to see a dataframe column.

**The logistic regression ships, not the gradient-boosted model** (D-013). On the
exported graph, LightGBM's `f(d) + f(−d)` drifted from 1 by ~3×10⁻²; the linear model
is antisymmetric by construction at ~3×10⁻⁸. A 3% asymmetry means two close lines can
swap winners depending on the order you pasted them in. A tool that gives different
answers to the same question is broken in a way no accuracy number rescues.

## Training and serving are different languages, so parity is tested

Training runs in Python. Inference runs in a serverless function, so feature
extraction happens again in TypeScript. That is training/serving skew by
construction (D-006). Three things make it testable rather than hopeful:

- Every lexicon exists **once**, as JSON in `shared/`. The TypeScript copy is
  generated and CI fails on drift.
- A frozen corpus of adversarial strings — ZWJ emoji families, regional-indicator
  flags, non-ASCII `Nd` digits, Turkish dotted capital İ, curly apostrophes,
  zero-width characters — compared element-wise at 1e-9.
- `parity/mutation_check.py` injects known bugs into the TypeScript extractor and
  asserts the suite catches each one. **A parity suite that has never failed is not
  evidence of parity.**

That last point earned itself twice. The mutation test caught all eight injected
bugs — and a later code review still found a real divergence the corpus could not
see, because every non-ASCII digit in it happened to be 1, 2 or 3 and the bug only
affected the value 9. The corpus now covers it. Coverage is a claim about the cases
you thought of.

## Running it

```bash
# 1. get the data (manual, by design)
#    see docs/GET_THE_DATA.md

# 2. train and evaluate
python -m subjectrank.train
python ml/scripts/write_model_card.py

# 3. verify before deploying - all four must pass
pytest ml/tests -q
cd web && npx tsx ../parity/run_parity.ts
python parity/mutation_check.py
python ml/scripts/gen_ts_lexicons.py --check

# 4. promote and run
python ml/scripts/promote_model.py
python ml/scripts/build_worked_example.py
cd web && npm install && npm run dev
```

`RUNBOOK.md` covers rollback, drift, and where every secret lives.

## Layout

```
DECISIONS.md      every consequential choice, with the rejected alternative
OPEN_QUESTIONS.md what I was unsure about and did not silently guess  <- read first
EXPERIMENTS.md    every training run, including the ones that failed
MODEL_CARD.md     generated from a run report; never hand-written
RUNBOOK.md        train, verify, roll back, read drift, respond to a bad prediction
MORNING.md        credentials-to-live checklist
docs/FEATURES.md  the feature spec both extractors implement
docs/DESIGN_DIRECTION.md  visual direction, and the anti-brief critique it failed once
ml/               pipeline, models, evaluation, ONNX export
web/              Next.js app, TypeScript extractor, ONNX inference
parity/           frozen corpus, parity runner, mutation tester
supabase/         migrations, RLS, and a script that asserts the RLS is really on
launch/           launch kit, unsent
```

## Licence and attribution

The Upworthy Research Archive is CC BY 4.0 and attribution is required — it appears
in this file, in `MODEL_CARD.md`, and visibly in the app footer.
