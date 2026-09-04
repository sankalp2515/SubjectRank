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

---

## D-012 — Features the training data barely contains are dropped, not shipped

**Date:** 2026-08-26

**Decision.** After pair construction, the pipeline measures each feature's
*support* — the fraction of training pairs where its difference is non-zero — and
drops any feature below `min_feature_support` (0.001) from the model. The dropped
list is reported in the model card.

**Reasoning.** Emoji are the motivating case and the mission document called it out
in advance: 2013–2015 Upworthy headlines contain almost none, while 2026 email
subject lines contain plenty. A coefficient fitted on a handful of pairs is not
knowledge; it is noise with a confident sign attached.

The failure mode this prevents is specific and bad. A user pastes a subject line
with a 🔥 in it, the attribution panel says "the emoji is hurting this line," and
that sentence is fabricated — the model has essentially never seen an emoji and has
no basis for the claim. §0 forbids exactly this, and the UI cannot be trusted to
suppress it case-by-case. Removing the feature from the model makes the bad
explanation unconstructible.

**Rejected alternative: keep the features, hide the attribution in the UI.** The
model would still be using them to rank, so the ranking would carry an effect the
interface has decided not to admit to. Worse than either shipping it honestly or
not shipping it.

**Consequence for the product.** SubjectRank will have nothing to say about emoji.
That is a real limitation, it goes on the landing page with the rest of the domain
gap, and it is a better answer than a made-up one.

---

## D-013 — Antisymmetry is a deployment gate, and the baseline wins it outright

**Date:** 2026-08-26

**Decision.** `f(d) + f(−d) = 1` is measured on the **exported ONNX graph** and
reported for every candidate. A model that violates it materially may not ship
without the violation appearing in `MODEL_CARD.md`.

**The measurement, on synthetic data during pipeline development:**

| model | ONNX antisymmetry violation |
|---|---:|
| baseline (logistic regression) | 3.0 × 10⁻⁸ |
| candidate (LightGBM) | 3.3 × 10⁻² |

Six orders of magnitude. These are synthetic-data numbers used to build the gate —
the real figures come from the training run and go in the model card — but the
*structural* point does not depend on the data:

- The baseline is antisymmetric **by construction**. `fit_intercept=False` plus
  `StandardScaler(with_mean=False)` makes the decision function an odd function of
  the difference vector, so the property holds exactly, for any input, forever.
- LightGBM is antisymmetric **only to the extent the augmented training data made
  it so**. A tree ensemble splits on thresholds, and nothing stops it learning a
  split at `x > 0.3` without the mirror at `x < −0.3`. Augmentation pushes toward
  symmetry; it does not impose it.

**Why this matters more than it sounds.** A 3% violation is not a rounding error in
this product. When two subject lines are close — which is the common case, and
exactly when a user most wants help — a 3% asymmetry can flip the winner depending
on **the order the user happened to paste them in**. A stranger who pastes the same
two lines twice and gets two different answers has correctly concluded the tool is
broken, and no amount of accuracy elsewhere recovers that.

**Consequence.** This is now an argument for the baseline that is independent of
accuracy. If LightGBM wins on pairwise accuracy by a small margin, it is buying
that margin with a correctness property the product visibly depends on, and the
baseline should ship. If it wins by a large margin, the tradeoff gets stated in the
model card with both numbers rather than resolved silently.

Per §6's logic — choosing the deployable model over the marginally-better one, and
being able to defend it, is the stronger signal — this is the same argument as the
TF-IDF rejection, arriving through a different door.

---

## D-014 — Train on exploratory + confirmatory; keep the archive's holdout locked

**Date:** 2026-08-27

**Decision.** `data/raw/` contains the **exploratory** and **confirmatory** subsets —
27,616 tests, 128,217 packages. The archive's own **hold-out** subset lives in
`data/holdout_locked/`, which the loader does not glob, so the pipeline is
structurally unable to see it. It is used exactly once, at the very end, as the
final untouched evaluation set.

**Context.** Q-001 asked whether the confirmatory subset was available. It is:
Sankalp downloaded the complete OSF archive with no access agreement, no
application, and no pre-registration commitment. All three files match the published
counts in Matias et al. Table 1 exactly (4,873/22,666 · 22,743/105,551 ·
4,871/22,600), and their byte sizes match the three independent GitHub mirrors
located in D-001 — so those mirrors were faithful, which is worth knowing if the
canonical source is ever unreachable again.

**Why the holdout stays locked.** Not caution — alignment. The archive's authors
constructed that subset *to be held out*. Using it as our final holdout is the use
it was designed for, and it gives the project something a self-made split cannot: an
evaluation set that was partitioned by someone else, before this project existed,
with no possibility of having leaked into any modelling decision.

That is a stronger position than a self-selected holdout, and it costs 4,871 tests
we would otherwise train on. Worth it.

**Rejected alternative: pool all three and split ourselves.** More training data and
a marginally better model. Rejected because the whole argument of this project is
that the evaluation is trustworthy, and "I designed my own holdout" is a weaker
sentence than "I used the one the dataset's authors set aside and never looked at
it until the end."

**Rejected alternative: exploratory only.** The conservative reading of Q-001. No
longer necessary now that access is settled as a fact rather than an assumption, and
it would have discarded 22,743 randomised experiments for a norms concern that does
not survive contact with how the data was actually distributed.

**The undeployed set is excluded entirely.** 78,232 packages, but only **57** of them
carry a non-zero impression count — they are tests that were created and never run.
No outcome, no label, no use.

---

## D-015 — Timestamp parsing is asserted, not trusted

**Date:** 2026-08-27

**Decision.** `created_at` is parsed with `format="ISO8601"`, and the loader raises
if any value fails.

**Reasoning.** The archive mixes two timestamp shapes in one column —
`2014-11-20 06:43:16.005` and `2015-03-12 18:04:35`. Pandas infers a single format
from the leading rows and coerces everything else to `NaT` under
`errors="coerce"`. On the exploratory subset that silently nulled **896 of 22,666**
dates, 4% of the file.

Nothing would have failed. The load would succeed, the counts would match, the tests
would pass — and the temporal holdout (D-005), the one split that produces the
number we actually report, would have been built over partially missing dates.

Found by profiling the file before trusting it rather than by any test, which is the
argument for profiling the file before trusting it.

---

## D-016 — The `problem` column does not exist in this release

**Date:** 2026-08-27

The archive's documentation describes a binary `problem` flag marking likely
randomisation failures, and `config.py` has `drop_problem_rows` for it. The
03.12.2020 package files carry no such column — the schema is 17 columns and that is
not one of them.

The pipeline already guards on `if "problem" in df.columns`, so it degrades
correctly. Recorded because the model card must not imply a filter that never ran,
and because a future release may reintroduce it.

---

## D-017 — A placing is a range whenever the model has not earned a number

**Date:** 2026-08-28

**Decision.** The comparison reports each line's placing as `1st`, or as `1st–2nd`
when the evidence does not support a single number. `lo` is one plus the count of
lines that beat it by more than `TOO_CLOSE_THRESHOLD`; `hi` is the total minus the
count it beats by more than the threshold. Exact placings appear only when the
model separated that line from every other. See `web/src/lib/placings.ts`.

**Reasoning.** An ordered list can only say "this one is second", and the sort
produces that claim whether or not the evidence supports it. Two lines inside the
noise floor get put in an order by `Array.sort`, not by the model, and every tool
in this category ships exactly that and calls it a ranking. A range is the honest
reading of what the model knows, it needs no legend, and no scorer can produce it.

**Rejected alternative: a shared placing number for tied lines** (both read `1st`,
the next reads `3rd`). It requires grouping lines into tie sets, and tie sets get
built by chaining adjacent pairs — which is not transitive. With scores
.60 / .57 / .54 at a .04 threshold the first and last *are* separable while neither
is separable from the middle. Chaining reports the top line as possibly-third,
contradicting the evidence. The range formulation is per-pair and cannot fail that
way.

**Rejected alternative: an ordered list plus a confidence badge.** The order is
still asserted and the badge is a number the reader is asked to trust, which the
brief names as a failure.

**Consequence.** `tooCloseToCall` from the server covers adjacent pairs only, so
the placing calculation applies the same constant to all pairs. That is why the
constant moved — see D-020.

---

## D-018 — No display typeface, and the visitor's own system face for their text

**Date:** 2026-08-28

**Decision.** One webfont, DM Mono, used only for what the *system* says: labels,
placings, measurements, verdict tags. Everything a human wrote — the visitor's
subject lines and the product's own prose — is set in the platform UI stack. There
is no display face, and no text on the page is larger than a subject line.

**Reasoning.** Two arguments, both about the product rather than about taste.

A subject line renders in the reader's mail client in something close to their
system UI face. Setting a visitor's draft in a bought serif flatters it into
looking like something it is not, which is the typographic version of a confident
meaningless score.

And the largest text on the page should belong to the visitor. A tool whose whole
position is that it refuses to inflate its claims has no business inflating its own
headline. It also serves the ten-second job better than a hero would: the biggest
object on screen is an empty subject-line field, which says what to do before a
word has been read.

**Rejected alternative: a display serif for the masthead and headline** (the v1
direction, Instrument Serif). It is the house style of every thoughtful indie tool
launched this year, this audience can smell it, and it puts the product's voice
above the visitor's words in the type hierarchy.

**Consequence.** If DM Mono fails to load, the machine voice degrades to the
platform mono and nothing breaks. The fallback stack is explicit.

---

## D-019 — "Not measured" is the only state rendered without colour

**Date:** 2026-08-28

**Decision.** `helps` is blue, `hurts` is rust, `no effect` is grey, and
`not measured` has **no hue at all**: an achromatic tag with a dotted rule, on a
hatched ground. All four are also spelled out as words — HELPS, HURTS, NO EFFECT,
NOT MEASURED — so no legend is needed and no colour-vision condition can lose the
meaning.

**Reasoning.** D-012 removed emoji from the model because a coefficient fitted on
almost no examples is noise with a confident sign attached. The interface has to
carry the same idea: giving "we have no opinion about this" a colour would imply
one, and would make it look like a fourth kind of finding rather than the absence
of one. Drawing it as a hole in the evidence is the only rendering that does not
overclaim.

**Rejected alternative: a fourth semantic hue** (amber, usually). It reads as a
warning, and a warning is a claim about the emoji. There is no claim to make.

**Rejected alternative: omitting the state.** Silence gets filled in by the reader,
and a reader who sees nothing about their emoji concludes it is fine.

Blue and rust rather than red and green, because that pair survives protanopia and
deuteranopia.

---

## D-020 — `TOO_CLOSE_THRESHOLD` lives in the browser-safe module, not in `model.ts`

**Date:** 2026-08-28

**Decision.** The constant is defined in `web/src/lib/placings.ts`. `lib/model.ts`
imports and re-exports it, so server-side callers keep one import path.

**Reasoning.** `placings.ts` runs in the browser. `model.ts` dynamically imports
`onnxruntime-node`. A *value* import from `model.ts` into a client component pulled
the entire ONNX runtime into the client bundle, and the production build failed on
`Can't resolve 'worker_threads'`. Type-only imports are erased and stay safe, so
`import type { RankedLine } from './model'` is fine and remains.

**Rejected alternative: duplicating the constant.** Two copies of the number that
decides whether the interface claims a tie is exactly the drift the parity suite
exists to prevent elsewhere in this repo.

Worth recording as a shape rather than as an incident: anything the comparison UI
needs at runtime has to live outside `model.ts`, because `model.ts` is where the
server boundary is.

---

## D-021 — One canonical delete control, in the footer

**Date:** 2026-08-28

**Decision.** "Delete everything I have submitted" appears once, in the footer,
directly beneath the sentence explaining that pasted lines become training data.

**Reasoning.** It was briefly in two places — a panel above the footer, and the
footer text — each with its own wording of the same promise. Two wordings of a
promise about someone's data is one too many, and a reader has no way to tell which
one binds. One statement, one control, adjacent.

**Rejected alternative: keeping it beside the result.** More discoverable at the
moment of use, but it makes the disclosure conditional on having run a comparison,
and the disclosure is not conditional.

---

## D-022 — The account offer attaches an address; it does not sign anyone in

**Date:** 2026-08-28

**Decision.** `POST /api/account` calls the new `DataLayer.attachEmail`, which
updates the existing anonymous `auth.users` row in place and marks the session
non-anonymous. The copy says the address attaches the visitor's comparisons to them
instead of to a cookie. It does not say a link was sent, because none is.

**Reasoning.** The uid does not change, so every ranking, note and reported outcome
already attached to that visitor follows them with no merge step — which is what
makes "keeping your comparisons" a true description rather than a euphemism for
signing up. The offer renders only once a comparison is on screen, never before.

**Rejected alternative: a magic-link sign-in flow.** It is the complete feature, and
it is also unbuilt, unconfigured and untested here. Shipping a button that promises
an email nobody sends is the same class of failure as a fabricated ranking, just
smaller.

**Open.** There is still no way to sign back in on a second device. The copy is
written so that nothing has to be walked back when that is built.

---

## D-023 — The comparison surface is inspected against a quarantined fixture

**Date:** 2026-08-28

**Decision.** `web/src/app/dev/preview` renders the real comparison components from
invented numbers. It returns 404 in production, nothing outside that route imports
its fixture, and the page carries a banner in the loudest state the design has,
saying the numbers are made up.

**Reasoning.** No champion model exists, so `worked_example.json` is `untrained` and
the landing page correctly shows a notice instead of a ranking. That is the right
behaviour, and it also means the second most important surface in the product cannot
be looked at — and looking is what catches what reading does not. It caught two
things here: the scale marked one line as the winner while the column beside it read
`1st–2nd`, and the mono voice failed AA on two of the three grounds it sits on.

**Rejected alternative: seeding the landing page's worked example from the
fixture.** That is precisely the fabrication this product exists to argue against,
and it would have shipped.

**Delete this route** once a champion is promoted and the worked example is real.

---

## D-024 — The machine's voice clears AA on the darkest ground it lands on

**Date:** 2026-08-28

**Decision.** `--ink-3`, the colour of every mono label and measurement, was
darkened from `#6B7278` to `#5E656B`. Form-control borders got their own token,
`--rule-control` `#8C8982`, separate from the hairlines used between rows of text.

**Reasoning.** Measured rather than eyeballed. `#6B7278` cleared 4.5:1 on white
(4.88) but not on the two greys it also sits on: 4.40 on the sunk surface and 3.91
on the field. That voice carries placings, measurements and the "not measured"
state, so it clears AA on the worst ground it appears on, not the best.

The border split is WCAG 1.4.11: a control's border is the only thing identifying
it as a control and needs 3:1, while a hairline separating two rows of text names no
target and does not. One token for each job, rather than one token failing half its
uses.

The input placeholder went from `#A2A7AB` (2.43:1) to `#74797E` (4.39:1). It is
doing real instructional work here and should not have been treated as decoration.

---

## D-025 — TF-IDF beat the hand features by ten points and was rejected anyway

**Date:** 2026-08-28

**Decision.** `variant_tfidf_logreg` is not shipped. `baseline_logreg` is.

**This is the uncomfortable entry in this file and it should stay that way.**
`docs/FEATURES.md` §6 predicted TF-IDF would lose and be rejected, and committed
to revisiting the decision *with the margin written down* if it won by a large
margin. It won by a large margin.

| | champion (48 hand features) | TF-IDF (162,594 features) | margin |
|---|---:|---:|---:|
| CV pairwise accuracy | 0.6138 | 0.7321 | **+0.1183** |
| Holdout pairwise accuracy | 0.5966 | 0.6952 | **+0.0986** |
| Holdout ROC-AUC | 0.6458 | 0.7653 | **+0.1195** |
| Holdout top-1 accuracy | 0.2829 | 0.3625 | **+0.0796** |
| Realised CTR lift vs mean | +6.35% | +14.47% | **+8.12pp** |
| Brier | 0.2334 | 0.2007 | better |

Word 1–2 grams plus `char_wb` 3–5 grams, logistic regression on the difference
vectors, `fit_intercept=False`, same augmentation, same folds, vectoriser fitted
on training text only. **The learner is held constant on purpose** — swapping in
LightGBM as well would have confounded the representation with the model class
and made the margin uninterpretable. The question §6 asks is about the features.

**The win is real, not memorisation.** That was the first suspicion, because
TF-IDF can memorise a repeated headline where hand features cannot. Measured: the
temporal holdout shares **35 of 8,582 headlines (0.4%)** with training, and
exactly **1 of 8,999 holdout pairs** has both sides seen. The group folds are a
different story — 13.6% headline overlap, 26.7% of pairs with a side seen — which
is why TF-IDF loses 3.7 points from CV to holdout while the baseline loses 1.7.
The holdout number survives that correction.

**Rejected on three grounds, in increasing order of weight.**

1. **Serving parity is not achievable.** Inference runs in TypeScript
   (D-006). Reproducing a fitted `char_wb` analyser byte-exactly in another
   language — its boundary padding, its lowercasing, its 162,594-term vocabulary
   and IDF vector — is the skew factory this project exists to argue against. The
   parity suite is the central engineering claim here, and it would have to cover
   a surface it cannot realistically cover.

2. **It learns exactly the thing that does not transfer.** D-011's claim is that
   the *direction of feature effects* carries from 2013–2015 viral headlines to
   2026 email. A vocabulary model has no such claim available to it: what it
   learned is which words got clicks on Upworthy in 2014. A 2026 newsletter about
   a SaaS product shares almost no vocabulary with that. The hand features are
   deliberately about *form* — length, punctuation, person, how the line opens —
   because form is the part with any chance of transferring. **The TF-IDF model is
   ten points better at a problem this product is not solving.**

3. **It destroys the second most important surface.** Every reason shown to a user
   traces to a feature and, where possible, to the exact characters it refers to.
   A 162,594-term sparse model can emit token weights, but "the word *Walmart*
   helps this line" is not advice, and D-012's rule — never attribute to a feature
   the model barely saw — becomes unenforceable across 162k terms with wildly
   varying support.

**Rejected alternative: ship TF-IDF and keep the hand-feature model only for
explanations.** Two models, one ranking and one explaining, which means the shown
reasoning would not be the reasoning that produced the ranking. That is a
fabrication with extra steps and it is worse than either option on its own.

**What would reverse this.** Reported outcomes from real email showing TF-IDF's
advantage surviving the domain gap. That is testable once the outcome-reporting
flow has data, and it is the single most interesting experiment this project has
queued. Until then the honest position is: the better in-domain model is not the
better product, and the gap is written down rather than hidden.

**The number goes in `MODEL_CARD.md`.** A rejection this large is not a footnote,
and an interviewer who finds it independently should find it in the card first.

---

## D-026 — LightGBM cannot be exported faithfully, which settles D-013 outright

**Date:** 2026-08-28

**Decision.** `candidate_lgbm` has no artifacts and cannot be promoted. The export
gate refuses it.

**The measurement, on real data this time** (D-013 was decided on synthetic):

| model | ONNX export fidelity (max ǀΔǀ) | vectors over tolerance | ONNX antisymmetry |
|---|---:|---:|---:|
| baseline_logreg | 1.024e-07 | 0 of 367 | **2.980e-08** |
| candidate_lgbm | **2.840e-02** | **4 of 367** | **1.349e-01** |

**The delta distribution is the diagnosis.** Median disagreement 1.957e-08 —
ordinary float32-vs-float64 residual — with four vectors at up to 2.84e-02.
Almost everything exact and a few things badly wrong is not a precision problem;
it is a split-threshold flip. The converter rounds a tree's threshold to float32
and samples sitting near it take the other branch. **The graph is a different
function from the model on about 1% of inputs, and a wider tolerance would not
make it the same function — it would just stop reporting the difference.**

So the D-013 question ("does a marginal accuracy gain justify losing exact
antisymmetry?") does not even arise. There is no faithful graph to weigh.

**Rejected alternative: raise `onnx_parity_tolerance` past 2.84e-02.** That is the
tempting one-line change and it is the wrong one twice over: it would hide a
functional divergence rather than fix it, and 2.84e-02 is large enough to flip the
winner between two close subject lines — precisely the case where a user most
wants help.

**Rejected alternative: abort the whole export when one model fails.** That was
the original behaviour and it lost the baseline's successful export because a
different model failed. Failures are now recorded per model, no metadata is
written for a failed one so it stays unpromotable, and the script exits non-zero.
The failure is a finding about that model's deployability and belongs in the run
report, not in a stack trace.

---

## D-027 — The worked example gets its scores from Python and its reasoning from TypeScript

**Date:** 2026-08-28

**Decision.** `build_worked_example.py` computes the ranking with the promoted
ONNX graph and writes scores, features and pairwise probabilities. It writes no
notes and no marks. `web/src/lib/worked.ts` derives those at build time by calling
the same `attribution.ts` the live request path calls.

**Reasoning.** The example must be a real ranking from the deployed model, so the
scores have to come from the graph. The attribution rules — which sentence a
feature earns, which characters may be marked, when the "not measured" state
fires — exist in exactly one language on purpose. Writing a Python twin of them to
fill this JSON would be a third implementation of the same rules, on the surface
where being wrong means a fabricated sentence about a user's own words.

Both halves read the same `champion.meta.json`, so they cannot disagree about
which features the model uses or what their coefficients are.

**This was a live bug, not a hypothetical.** The example JSON had no `notes`,
`marks` or `normalisedText` fields at all, so the landing page crashed during
prerender on `line.marks.map`. Caught by `next build`, which is why that gate is
in the list.

**Also fixed here:** `build_worked_example.py` read
`ml/artifacts/champion.meta.json` — a path nothing in the pipeline creates.
Training writes `<model>.onnx` there and `promote_model.py` copies the chosen one
to `web/model/champion.onnx`. The script therefore always took its "untrained"
branch and the landing page kept showing the no-model notice after a successful
promotion. It now reads the promoted artifact, which is also the correct
semantics: the worked example should be what is actually served.

---

## D-028 — Every feature the champion uses must have a plain-language phrase, checked

**Date:** 2026-08-28

**Decision.** `parity/phrases_check.ts` fails if the promoted model uses a feature
with no entry in `PHRASES`. The fallback in `describe()` no longer prints the
feature's internal name.

**Reasoning.** A live comparison rendered this under a subject line:

> **HELPS** — more ft determiner than the others

Eight features — the whole first-token class family from D-008 — had no phrase,
and the fallback turned `ft_determiner` into English by replacing underscores
with spaces. All eight are in the shipped model, so any of them could surface.

Machine vocabulary in a sentence someone is asked to judge is the same failure as
a number they are asked to trust: **they cannot check either.** CLAUDE.md's rule
is to name things by what the person controls, and "ft determiner" names an array
index.

A code review did not catch this and a type could not — `PHRASES` is a
`Record<string, Phrase>` and a missing key is legal. Looking at a rendered
comparison caught it, which is the fourth time that has been true in this project.

**Rejected alternative: make `PHRASES` exhaustive over `FEATURE_NAMES` in the type
system.** Attractive, and it fails for the right-seeming wrong reason: the
extractor computes 52 features and the model uses 48, so the type would demand
phrases for features that can never appear in attribution, and the next dropped
feature would break the build for no user-visible reason. The check is keyed on
**what the champion actually uses**, which is the set that can reach a reader.

The fallback now says only what is certainly true — that the property differs —
and never pretends an internal name is English.

---

## D-029 — What moves to Azure, and what deliberately does not

**Date:** 2026-09-03

**Decision.** Container Apps runs the app, Azure ML owns training and the model
registry, Blob Storage holds the archive and artifacts. Supabase stays exactly
where it is. Nothing is added to the diagram that does not do work.

**Reasoning.** The honest test for adding a cloud service to a portfolio project
is whether an interviewer asking *"why is that there?"* gets an answer about the
project or an answer about the CV. Each service here was chosen against a gap the
project actually had:

| gap before | service | what it replaced |
|---|---|---|
| not deployed anywhere | Container Apps | nothing — it ran on a laptop |
| training was a local script with no lineage | Azure ML job | `python -m subjectrank.train`, untracked |
| promotion was a file copy | Azure ML model registry | `shutil.copy2` and a filename |
| the training bytes lived on one disk | Blob Storage, versioned + hashed | nothing |
| gates ran when someone remembered | GitHub Actions | manual |

**Rejected: migrating Supabase to Azure Database for PostgreSQL.** This is the
one that would have looked best on a diagram and been worth least. The Supabase
side already has the schema, the row-level security policies, and
`supabase/migrations/0008_verify_rls.sql`, which asserts the RLS is actually on
rather than assuming it. Rebuilding all of that against a different Postgres to
arrive at identical behaviour is motion, not progress, and it would have put the
project's only real security work at risk to gain a logo.

**Rejected: Azure OpenAI or any Cognitive Service.** Nothing in this product
calls a language model. The ranker is a 48-feature logistic regression, and that
is a deliberate, defended choice (D-025). Bolting on an LLM to have a fashionable
service in the architecture would be exactly the resume padding this project's
whole thesis argues against — and the first interviewer to ask what it does would
get a worse answer than "there isn't one, here's why."

**Rejected: AKS.** One stateless container serving no traffic does not need
Kubernetes. Being able to say that is worth more than running one.

**The claim this earns.** Not "I used Azure." It is: *the model registry is the
record of what may serve traffic, and the same gate code decides that in the
registry and on a laptop.* That is a sentence about the system.

---

## D-030 — The image carries the model; the registry decides which model

**Date:** 2026-09-03

**Decision.** `web/model/champion.onnx` stays gitignored. CI fetches the
registry's `champion` alias into `web/model/` and the Docker build bakes it in,
failing loudly if it is absent. The image and the model are one artifact with one
sha256, and `/api/health` reports that sha256 so the live answer to "which model
is serving?" is a curl rather than a pipeline log.

**Reasoning.** Three options, and the middle one is the trap.

*Commit the binary.* It is 2,427 bytes, so size is not the objection. The
objection is that a committed artifact can drift from whatever was actually
promoted, and then the repo and the registry disagree about what shipped with
nothing to reconcile them.

*Fetch at container startup.* Rejected. A container that downloads its model on
boot can start successfully and serve a different model from the one that was
tested, and it puts a network dependency on every cold start. Worse, the failure
is invisible: the app has an honest "no model deployed" 503, so a broken fetch
degrades into a page that politely tells every visitor there is nothing to
compare with.

*Bake it at build time, decided by the registry.* Chosen. `fetch_model.py`
re-runs the promotion gates against **this checkout's** extractor rather than
trusting the tag written at registration, and verifies the artifact's sha256
against the one recorded in the registry. A build cannot produce an image from a
model this code cannot serve correctly.

**Consequence, stated because it is a real cost.** `minReplicas: 0` means a cold
start on the first request after idle, on top of the ~2.5s ONNX session creation
measured in session 1. A visitor arriving at a cold app waits. That is the price
of not billing for an idle container, and it is written here rather than
discovered by whoever gets the first shared link.

**Measured while building this:** the runtime image was 833 MB, of which **216 MB
was macOS and Windows ONNX binaries a Linux container cannot execute**. Pruning
them in the *build* stage took it to 523 MB. The first attempt pruned in the
runtime stage and changed the size by 1 MB in the wrong direction, because
Docker layers are additive and deleting a file in a later layer leaves it in the
earlier one.

---

## D-031 — The endpoint benchmark exists; the number does not yet

**Date:** 2026-09-03

**Decision.** `azure/ml/score.py`, `endpoint.yml` and `deployment.yml` stand up an
Azure ML managed online endpoint **for measurement only**. The product does not
serve through it. `azure/bench/benchmark.mjs` measures both paths and
`azure/bench/report.mjs` renders the comparison — and **refuses to state a verdict
until both targets are in the same run**.

**Reasoning.** D-006 chose in-process ONNX in a Node function over a separate
Python inference service, citing cold starts and cost. That was reasoning, and it
has sat in `DECISIONS.md` unmeasured ever since. A project whose entire argument
is "measure it, then decide" should not have a load-bearing architectural
decision resting on an assumption.

**What has been measured so far, and what has not.** The in-process path, in the
production container image, on this machine:

| | p50 | p90 | p99 | first request | errors |
|---|---:|---:|---:|---:|---:|
| container (warm) | 45.45 ms | 70.11 ms | 101.97 ms | 187.97 ms | 0/120 |

**There is no Azure column, because no endpoint has been deployed.** The harness
prints "No verdict yet" and exits without a conclusion, which is the correct
behaviour and is why the report is generated rather than written. See Q-011.

**The part no benchmark can measure, recorded now so it is not forgotten when the
latency numbers arrive.** `score.py` cannot import the TypeScript extractor, so
it uses the Python one. An endpoint-based architecture would therefore need the
parity suite to police a *third* implementation boundary — Python-training vs
Python-serving vs TypeScript-client — instead of the two it covers today. If the
endpoint wins on latency, that cost still has to be weighed against it, and it
will not appear in any table the harness produces.

**Rejected: skipping the benchmark and keeping D-006 as reasoning.** It is the
cheaper option and it leaves the project's own standard unmet.

**Rejected: leaving the endpoint running so the numbers stay fresh.** It is the
only resource in `azure/README.md` that bills continuously while idle. It gets
created, measured, and deleted.

---

## D-032 — Vercel is the home; Azure is a session

**Date:** 2026-09-03

**Decision.** The live app deploys to **Vercel Hobby + Supabase Free**, which are
free indefinitely. Azure is used **time-boxed inside trial or student credit** for
the training job, the model registry and the D-031 benchmark, and the resource
group is deleted afterwards.

**Reasoning.** The constraint is no pay-as-you-go billing, and that settles it on
a single fact: **Azure Container Registry Basic has no free tier.** Roughly $5 a
month, forever, for the registry alone — so an Azure-hosted app does not degrade
when credit runs out, it breaks. Container Apps' monthly free grant and
scale-to-zero would have covered the compute; the registry is what makes it
untenable.

Vercel was checked rather than assumed:

* function bundle ≈ 100 MB (67 MB Linux ONNX binary + 0.9 MB onnxruntime-common
  + ~30 MB server output) against a 250 MB uncompressed limit;
* `model/**` verified present in the trace files for `/api/rank` **and**
  `/api/health`, read out of the build's `.nft.json` rather than assumed;
* the container-only `output: 'standalone'` gated behind `BUILD_TARGET=container`
  so one `next.config.mjs` is correct for both targets.

**Consequence: the champion is now committed.** `web/model/champion.onnx` was
gitignored on the reasoning in D-030 that the registry should decide what ships.
That reasoning holds for the container path and fails for Vercel, which builds
from git and has no registry to ask. An ignored artifact would have deployed an
app that serves its honest "no model deployed" 503 to every visitor — a failure
that renders as a working page, which is the worst kind. At 2,427 bytes the usual
objection to binaries in git does not apply. Git is the floor; when a registry
exists, `azure/ml/fetch_model.py` overwrites it and re-runs the promotion gates
against the checked-out extractor first.

**Rejected: Azure Container Apps as the permanent home.** It is the tidier
architecture and it is the wrong one under this constraint. Deferred, not
abandoned — `azure/infra/main.bicep` still describes it, and swapping ACR for
`ghcr.io` (free for public images) would make it viable if the constraint ever
lifts.

**Rejected: dropping Azure entirely.** The parts of this project Azure genuinely
improves are the parts that have no other answer: training with lineage, a model
registry as the record of what may serve traffic, and the measurement D-006 has
been missing since session 1. Those are worth one hour and a few pounds of
credit. Running them and then tearing the environment down is also a better
answer to "why isn't it still up?" than leaving a bill running would be.

**Cost of the split, stated.** Two deploy targets means two paths that can rot
independently. The mitigation is that both are exercised: `web/Dockerfile` builds
and the image is verified locally, and `docs/DEPLOY.md` names the Vercel-specific
trap (Root Directory must be `web`) that no config file can express.
