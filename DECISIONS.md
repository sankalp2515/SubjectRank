# DECISIONS

Every consequential choice, written at the moment it was made, with the alternative
that was rejected and why. Newest decisions append at the bottom.

Test for this file: could Sankalp defend any technical choice in an interview using
only this file? If not, it isn't detailed enough.

---

## D-001 — Source the archive from OSF directly, not from GitHub mirrors

**Date:** 2026-08-26

**Decision.** The Upworthy Research Archive is downloaded by hand from
<https://osf.io/jd64p/> and placed in `data/raw/`. No third-party copy is used.

**Context.** `osf.io`, `files.osf.io`, `zenodo.org`, `huggingface.co`, `kaggle.com`
and `cran.r-project.org` all fail DNS/TLS from both the agent's cloud container and
the desktop shell. Only `github.com`, `pypi.org` and `registry.npmjs.org` resolve.
The canonical download is therefore impossible to automate in this environment.

**Rejected alternative: GitHub mirrors.** Three public repositories
(`VinayReddy-9877/upworthy-ab-testing-analytics`, `adebam/Upworthy_Project`,
`ZuhalA/upworthy-ab-meta-analysis`) carry the archive CSVs. Their file sizes agree
exactly across repositories — exploratory 14,260,949 B in all three, confirmatory
66,517,697 B and holdout 14,174,776 B in two — so cross-mirror SHA256 verification
plus a row-count assertion against the paper's published figures would have given
reasonable confidence.

**Why rejected anyway.** Three reasons, in increasing order of weight:

1. Byte-identical mirrors prove the copies agree with *each other*, not that they
   agree with the original. All three could descend from one bad copy.
2. The archive is CC BY 4.0 and its authors ask to be cited as the source. Citing
   OSF in the model card while having actually loaded a stranger's repository is a
   provenance claim that isn't quite true, and §0 forbids claims that aren't.
3. This is a hiring artifact. "Where did your training data come from?" is a
   near-certain interview question, and "the official archive" is a materially
   better answer than "a GitHub repo whose checksums matched two other GitHub repos."

**Cost accepted.** The pipeline blocks on a human download. Everything not touching
the data — feature spec, both extractors, parity suite, split logic, training and
evaluation code — is written first so the block costs sequencing, not hours.

**Reversible?** Yes, trivially. If OSF is unreachable for Sankalp too, the mirror
route is still available and this entry becomes the record of why it was the fallback
rather than the default.

---

## D-002 — Pairwise ranking, not pointwise open-rate regression

**Date:** 2026-08-26

**Decision.** The model predicts *which of two subject lines wins*, from the feature
difference vector `x_A − x_B`. It never predicts an absolute rate.

**Reasoning.** Three independent arguments converge:

- **Product.** The user's actual question is "which of these should I send?", not
  "what will my open rate be?" Ranking answers the question asked.
- **Statistical.** Absolute CTR in the Upworthy data is dominated by test-level
  effects — the story, the image, the day, the audience — which a subject line
  cannot influence. Differencing within a test cancels every one of those. A
  pointwise regression would spend most of its capacity modelling nuisance.
- **Honesty under domain shift.** The training domain is 2013–2015 US viral media
  headlines; users write 2026 email subject lines. Absolute levels certainly do not
  transfer. The *direction* of feature effects plausibly transfers better. Ranking
  is the framing that only requires the weaker claim. See D-011.

**Rejected alternative: regress CTR (or logit CTR) per arm, then sort.** Rejected
because it produces a number that looks like a prediction of open rate, and users
will read it as one no matter how it is labelled. §3 forbids ever predicting absolute
open rate; the cleanest way to keep that promise is to build a model structurally
incapable of it.

**Consequence.** Antisymmetry — `f(x_B − x_A) = 1 − f(x_A − x_B)` — is a property we
want and do not get for free. It is enforced by augmenting every training pair in
both directions. See D-009.

---

## D-003 — Train only on pairs that share an eyecatcher_id

**Date:** 2026-08-26

**Decision.** A training pair is two packages from the same `clickability_test_id`
that also share the same `eyecatcher_id`. Pairs whose images differ are dropped.

**Reasoning.** Upworthy tests varied headline *and* image simultaneously. A CTR
difference between two arms with different images is a joint headline+image effect,
and attributing it to the headline is simply wrong. The archive's own documentation
is explicit: "packages within the same test that share the same image can be compared
to each other."

**Rejected alternative: use all within-test pairs and add image id as a feature.**
Rejected because `eyecatcher_id` is a high-cardinality identifier with no meaning at
serving time — a user's subject line has no image — so the model would learn image
effects it can never apply, and the headline coefficients would absorb whatever the
image term failed to explain. Controlling for a confounder you cannot observe at
inference is not control.

**Cost accepted.** Substantially fewer usable pairs. The exact number surviving this
filter is logged by the pipeline and reported in `MODEL_CARD.md`; if it turns out to
be too small to train on, that is a finding to report, not a reason to relax the
filter.

**This is the single decision most likely to separate a defensible model from a
broken one.**

---

## D-004 — Four columns are banned as features

**Date:** 2026-08-26

**Decision.** `impressions`, `winner`, `first_place` and `significance` may never
enter the feature matrix. This is asserted in code, not just intended.

**Reasoning, per column:**

- **`impressions`** — the famous trap in this dataset. Arms accumulated impressions
  as the test ran, and editors stopped tests once a winner was apparent. Impression
  count therefore encodes the outcome and its own stopping decision. A model given
  impressions will look excellent and have learned nothing about headlines.
- **`winner`** — literally the editorial decision that followed the test result.
- **`first_place`** — a metric shown to editors to guide test selection; downstream
  of the outcome.
- **`significance`** — a custom CTR-vs-history calculation whose mathematical
  definition, per the paper, "changed over time and is not consistent throughout the
  dataset." Both target-derived and non-stationary.

Only `clicks` and `impressions` are used, and only to *construct the label*
(CTR = clicks/impressions) — never as inputs.

**Enforcement.** The feature extractor takes a single string and nothing else. It is
structurally impossible for it to see a dataframe column. The pipeline additionally
asserts that the feature-name list and the banned-column list are disjoint.

---

## D-005 — Group split for selection, temporal split for the honest number

**Date:** 2026-08-26

**Decision.** Two splits, both reported:

1. **Model selection:** `GroupKFold` grouped on `clickability_test_id`.
2. **Final holdout:** date-based cut on the most recent slice of the archive, by
   `created_at` / `test_week`.

**Reasoning.** They defend against different failures.

Grouping by test id defends against the obvious leak: arms within a test share a
story, an image, an editor and a day. Splitting by row puts near-duplicate rows on
both sides of the split and inflates every metric.

The temporal holdout defends against a subtler one: Upworthy's editorial style
drifted measurably across 2013–2015, and a randomly-grouped split lets the model see
the future. Since the deployed model will face 2026 text, the time-forward number is
the one that actually estimates generalisation.

**Both numbers get reported, including the gap between them.** The gap is itself a
measurement of how fast this domain moves, and it is the empirical basis for taking
the 2026 domain gap seriously rather than hand-waving it.

**Rejected alternative: report only the group-split number.** It will be the higher
one. Reporting it alone would be the kind of quiet overstatement §0 exists to prevent.

---

## D-006 — Hand-engineered features, specified once and implemented twice

**Date:** 2026-08-26

**Decision.** Features are defined in `docs/FEATURES.md` as a language-neutral
specification precise enough to implement independently in Python (training) and
TypeScript (serving). Any lexicon or word list lives in `shared/lexicons/*.json` and
is read by *both* implementations from the same file.

**Reasoning.** Inference runs in a Vercel serverless function via `onnxruntime-node`,
so feature extraction happens in TypeScript at request time while training happened
in Python. That is a training/serving skew risk by construction. The mitigation is
not "be careful" — it is (a) a written spec that resolves every ambiguity, (b) one
copy of every lexicon rather than two, and (c) a parity suite that fails CI on any
element-wise divergence.

**Rejected alternative: run a Python inference service.** It removes the skew risk
entirely, and it was rejected because it adds a second host, cold starts, and a bill,
for a free tool. The skew risk is real but it is *testable*, and a tested risk is
preferable to an architectural one.

---

## D-007 — Custom lexicon polarity, not VADER

**Date:** 2026-08-26

**Decision.** Sentiment polarity is a plain lexicon lookup over a shared JSON file,
not NLTK's VADER.

**Reasoning.** VADER is the obvious choice and the standard one for this dataset —
the reference preprocessing script published alongside a paper on this same archive
uses it. But VADER is not just a lexicon: it applies booster words, negation windows,
contrastive-conjunction handling, punctuation amplification and a normalisation
constant. Reproducing all of that byte-exactly in TypeScript is achievable and is
exactly the kind of thing that silently drifts on an edge case six months later.

A lexicon lookup with an explicit negation rule, defined in `FEATURES.md` and driven
by one shared JSON file, is weaker as sentiment analysis and far stronger as a
component of a system that must produce identical numbers in two languages.

**Cost accepted.** Some sentiment signal is lost. If the ablation shows the loss is
material, that goes in `EXPERIMENTS.md` and the decision gets revisited with numbers
attached rather than reversed on instinct.

---

## D-008 — First-token category by closed-class lookup, not a POS tagger

**Date:** 2026-08-26

**Decision.** The "part of speech of the first token" feature is implemented as a
lookup into a small closed-class word list (determiner, wh-word, pronoun, preposition,
auxiliary, numeral, other), not as a statistical POS tag.

**Reasoning.** Same logic as D-007, more severe. A statistical tagger — spaCy, NLTK's
averaged perceptron — cannot be reimplemented in TypeScript at all without shipping
the model and reimplementing the tagger's own feature extraction, which is a skew
factory nested inside a skew factory.

The signal the feature is actually reaching for is captured almost entirely by closed
classes anyway: headlines starting with "This", "What", "Why", "How", "9", "Watch"
are the pattern of interest, and every one of those is a closed-class or numeric
lookup. Open-class disambiguation adds little here.

**Documented as a simplification, not presented as POS tagging.** The feature is
named `first_token_class`, not `first_token_pos`, so the model card doesn't imply
capability the system doesn't have.

---

## D-009 — Antisymmetry by augmentation, enforced by test

**Date:** 2026-08-26

**Decision.** Every training pair is emitted twice — as `(x_A − x_B, 1)` and
`(x_B − x_A, 0)`. A unit test asserts `|f(d) + f(−d) − 1| < tol` across the frozen
corpus for the trained model.

**Reasoning.** "A beats B" and "B beats A" must be the same statement. Nothing in
logistic regression or LightGBM guarantees this: a tree ensemble in particular will
happily learn asymmetric splits and produce `f(d) + f(−d) ≠ 1`, which surfaces to the
user as a ranking that changes when they reorder their inputs. That is the single
most obviously broken thing this product could do.

Augmentation makes the training distribution symmetric, which makes the learned
function approximately antisymmetric. The test is what turns "approximately" into a
number we can report, and it is why the tolerance is asserted rather than assumed.

**Rejected alternative: a structurally antisymmetric model** (e.g. scoring each line
independently and comparing scores). Cleaner guarantee, but it collapses back to a
pointwise scorer and gives up the ability to model interactions between the two lines
being compared. Revisit if the antisymmetry test shows meaningful violation.

---

## D-010 — Label only pairs whose CTR difference survives a two-proportion z-test

**Date:** 2026-08-26

**Decision.** A pair is labelled only if a two-proportion z-test on
(clicks_A/impressions_A) vs (clicks_B/impressions_B) rejects at the chosen threshold.
Indistinguishable pairs are dropped, not labelled by sign.

**Reasoning.** Many Upworthy arms have low impression counts, where the observed CTR
ordering is mostly noise. Labelling those by raw sign teaches the model to predict
coin flips and — worse — depresses every reported metric in a way that makes a good
model look mediocre and hides whether the features work at all.

**Threshold.** Set in config, reported in `EXPERIMENTS.md`, and swept as a sensitivity
analysis rather than picked once and forgotten. Both the surviving-pair count and the
metrics at each threshold get logged, because "how many pairs survived?" is an
interview question and the answer should be a table.

**Rejected alternative: keep all pairs, weight by inverse variance.** Legitimate and
arguably better use of the data. Rejected for tonight on time grounds — it adds a
weighting scheme to justify on top of everything else. Logged in `OPEN_QUESTIONS.md`
as a known improvement rather than silently skipped.

---

## D-011 — What we claim transfers, stated as a hypothesis

**Date:** 2026-08-26

**Decision.** The product claims that the *direction* of feature effects transfers
from 2013–2015 viral headlines to 2026 email subject lines better than the *levels*
do. This is labelled a hypothesis everywhere it appears, including on the landing page.

**Reasoning.** It is a hypothesis. We have no email subject line data with real open
rates — none is public; the academic work on subject-line prediction uses proprietary
corpora that were never released — so there is no held-out set on which to test the
transfer claim. Presenting an untested transfer assumption as a finding would be the
exact failure mode §0 is written to prevent.

The user-reported outcomes flow exists precisely to start testing it. Until those
accumulate, the honest position is: here is a model, here is what it was trained on,
here is the gap, here is why we rank instead of score.

**This limitation goes on the landing page, not in a footnote.** Against every
instinct about conversion, and deliberately: it is the only thing distinguishing this
from the "AI email score" tools that output a confident meaningless number.
