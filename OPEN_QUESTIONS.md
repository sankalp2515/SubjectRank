# OPEN QUESTIONS

Things the agent was unsure about and did **not** silently guess. Sankalp reads this
first. Each entry states what is uncertain, why it matters, what was done in the
meantime, and what decision is needed.

---

## Q-001 — Is the confirmatory dataset actually open, and does §14's "32,487" survive?

> **RESOLVED.** The complete OSF archive downloaded with no access agreement, no
> application and no pre-registration commitment. All three files match the
> published counts exactly. D-014 records the decision: train on exploratory +
> confirmatory (**27,616 tests / 128,217 packages**), keep the archive's own hold-out
> subset locked and unseen as the final evaluation set.
>
> **§14's number is therefore 27,616, not 32,487.** The archive contains 32,487
> experiments; this model is trained on 27,616 of them and evaluated on the rest.
> Say that, not the bigger number. The original text below is kept for the record.

**Raised:** 2026-08-26 · **Status:** RESOLVED 2026-08-27 — see D-014

**The conflict.** Two authoritative sources disagree about access.

- The Nature Scientific Data paper describes the archive as open access under
  CC BY 4.0, all three subsets, no application described.
- The archive's own documentation site states the exploratory dataset is available
  for research and teaching while the confirmatory dataset is "reserved for
  registered/confirmatory research" and that access "requires peer-reviewed analysis
  plans."

**Why it matters.** §14's sentence opens with *"I trained a pairwise ranking model on
32,487 randomized headline experiments."* That number is the whole archive. The
subsets are:

| Subset | Tests | Packages |
|---|---:|---:|
| Exploratory | 4,873 | 22,666 |
| Confirmatory | 22,743 | 105,551 |
| Hold-out | 4,871 | 22,600 |
| **Total** | **32,487** | **150,817** |

If we train on exploratory only, "32,487 experiments" is false by a factor of about
6.7. Per §14 the instruction is to delete the clause, not soften it — so the sentence
becomes *"...on 4,873 randomized headline experiments comprising 22,666 arms."*

**Additional wrinkle.** Even if the confirmatory set downloads freely, there is a
research-norms question about using a set the authors reserved for pre-registered
confirmatory work as training data for a product. It is very likely fine under CC BY
4.0 as a legal matter. It is a slightly different question as a community-norms
matter, and "I used the confirmatory set without a pre-registered plan" is a sentence
an interviewer might have opinions about.

**What was done meanwhile.** The pipeline is written to work on whichever subsets are
present in `data/raw/`. It profiles what it finds, asserts the published counts for
each file it sees, and reports the training corpus size from what actually loaded —
so no claim is hardcoded and the model card fills itself in from the real number.

**Decision needed from Sankalp:**

1. Exploratory only — smallest true claim, zero norms risk, and honestly still a
   perfectly good story. **Agent's recommendation.**
2. Exploratory + holdout, if both download freely — the holdout is *also* reserved by
   design, so this has the same norms question as (3) with less of the upside.
3. All three — biggest number, requires being comfortable with the norms question.

Until this is answered, treat every "32,487" in draft copy, the README, and the
launch kit as a placeholder that must be reconciled before anything is published.

---

## Q-002 — Inverse-variance pair weighting was skipped for time

**Raised:** 2026-08-26 · **Status:** OPEN · **Blocks:** nothing · **Severity:** low

D-010 drops pairs whose CTR difference fails a two-proportion z-test. The better
approach is arguably to keep every pair and weight by inverse variance, which uses the
low-impression pairs for the little information they carry instead of discarding them.

Skipped tonight because it adds a weighting scheme that needs its own justification
and its own sensitivity analysis. Logged rather than silently omitted. If asked "why
did you throw data away?" in an interview, the honest answer is "I made a
noise-versus-volume tradeoff explicitly, here is the threshold sweep, and here is the
alternative I'd try next" — which is a fine answer, but only if this entry exists.

---

## Q-003 — No way to validate the transfer hypothesis before launch

**Raised:** 2026-08-26 · **Status:** OPEN by construction · **Blocks:** nothing

D-011 claims feature-effect *direction* transfers from 2013–2015 viral headlines to
2026 email subject lines better than *levels* do. There is no public dataset of email
subject lines with real open rates against which to test this — this was checked; the
academic literature uses proprietary corpora that were never released, and the public
"email campaign" datasets on Kaggle and Hugging Face are mock, synthetic or
unlabelled.

So the central product assumption ships untested. That is not a bug to fix tonight;
it is the reason the outcome-reporting flow exists and the reason the limitation is on
the landing page rather than in a footnote.

Flagged here so that it is never accidentally described as validated. The first time
user-reported outcomes support or contradict it, that becomes the most interesting
sentence in the whole project — in either direction.

---

## Q-004 — Apple MPP makes "open rate" a partly synthetic metric, and users will ask

**Raised:** 2026-08-26 · **Status:** OPEN · **Blocks:** nothing · **Affects:** copy

Apple Mail Privacy Protection pre-fetches tracking pixels, which inflates and
decorrelates measured open rates for a large share of any list. This is genuinely the
most interesting hook in the launch kit and it cuts both ways:

- It strengthens the case for *not* predicting absolute open rate — the thing we
  refuse to predict is the thing that got least trustworthy.
- It weakens the value of the user-reported outcome loop, because what users report
  back as "what happened" is itself measured through the same distorted instrument.

Unresolved: whether `/api/outcome` should ask users what fraction of their list is
Apple Mail, or ask for clicks rather than opens, or simply record opens and carry the
caveat. Leaning toward *also* collecting clicks, since clicks are what Upworthy
measured and it keeps the training and reporting outcomes commensurable. Needs a
product call before the outcome form is finalised.

---

## Q-005 — The account offer stops short of a sign-in

**Raised:** 2026-08-28 - **Status:** OPEN - **Blocks:** nothing - **Severity:** low

D-022 ships an account offer that attaches an email to the visitor's existing
anonymous uid. It does not send a link and it does not sign anyone in, so the
comparisons a person "keeps" are still only reachable from the browser that made
them. The copy is written to be true of that, and true again once a real sign-in
exists, so nothing has to be walked back.

What is missing is the second half: a magic link, or any flow that lets someone
open their comparisons on a phone after running them on a laptop. It was left out
rather than stubbed because a button promising an email nobody sends is the same
class of failure as a fabricated ranking.

**Decision needed:** whether the account is worth building at all before there are
users to want it, or whether the honest move is to drop the offer until then.

---

## Q-006 - Two pre-deploy gates cannot run in this environment

> **RESOLVED 2026-08-28.** `pip install lightgbm onnx skl2onnx onnxruntime
> onnxmltools` into the venv. `pytest ml/tests -q` is now **966 passed**, and the
> mutation gate runs and passes 9/9 with the platform-aware shim. Both blockers
> were environment, not code. **There is still no requirements file in the repo,
> so the next machine hits the same wall** - that part is not resolved.

**Raised:** 2026-08-28 - **Status:** RESOLVED (see note) - **Blocks:** nothing now

`pytest ml/tests` reports **965 passed, 1 failed**. The failure is
`test_pipeline_smoke.py::test_model_learns_the_planted_signal_and_exports`, and it
fails on `ModuleNotFoundError: No module named 'onnx'`. `skl2onnx` and
`onnxruntime` are also absent from the venv. This is an environment gap, not a code
defect - but it means the ONNX export path is currently untested here, and the
export fidelity gate (D-013's neighbour) has not run.

Consequence: **the model cannot be trained and promoted from this machine as it
stands**, which is also why `worked_example.json` is still `untrained` and the
landing page shows the honest no-example notice.

`python parity/mutation_check.py` could not start at all: it invoked
`node_modules/.bin/tsx`, which npm only writes as `tsx.cmd` on Windows. Fixed in
this session - the runner now picks the right shim per platform, and the gate then
passes 9/9. Worth noting that a required gate had been silently unrunnable.

**To resolve:** `pip install onnx skl2onnx onnxruntime` into the venv, re-run
`pytest ml/tests -q`, and confirm 966/966 before any deploy.

---

## Q-007 — Three correlated length features are shown as three independent reasons, with opposite signs

**Raised:** 2026-08-28 · **Status:** OPEN · **Blocks:** nothing · **Severity:** medium

A real comparison from the shipped model renders this on one line:

> **HURTS** — 54 characters — longer than the others you gave us · this line 54 · your others 33.5
> **HELPS** — more syllables · this line 13 · your others 7.5
> **HELPS** — more words than the others · this line 11 · your others 6

Every sentence is true and every number is correct. Together they are misleading
in two ways.

**They are not three pieces of evidence.** Character count, syllable count and
word count are near-collinear on subject lines. A linear model splits one effect
across correlated features and the split is arbitrary — which is also why the
signs disagree. The attribution panel presents them as three separate findings,
so a reader counts three where there is roughly one.

**The contradiction reads as incoherence.** "Longer hurts" directly above "more
words helps" invites the conclusion that the tool does not know what it thinks,
and a skeptical reader is right to draw it from what is on screen.

Neither is a fabrication, which is why this is a question rather than a bug, and
why nothing was changed quietly. But "technically true and predictably
misread" is close enough to the line that it should be a deliberate call.

**Options.**

1. Group correlated features into one reason with one sign, from a fixed grouping
   in the feature spec. Honest and much clearer; requires deciding the groups and
   how to combine contributions, and the combination needs its own justification.
2. Show only the single strongest reason per correlated family. Simplest, loses
   real information.
3. Say so in the interface — a line under the reasons noting that length-related
   properties are measured several ways and may disagree. Cheapest, most honest,
   least satisfying.
4. Regularise differently at training time (drop or combine collinear features)
   so the model itself stops splitting the effect. The real fix, and the one that
   changes the model rather than the presentation.

**Agent's recommendation: (4) with (3) shipped in the meantime.** Not done here
because changing the feature set changes `FEATURE_SPEC_VERSION`, which invalidates
the parity corpus and the promoted model — too large to fold into this session
without its own sweep and its own evaluation.

---

## Q-008 — "I sent something else" is in the design and impossible in the schema

**Raised:** 2026-08-28 · **Status:** OPEN · **Blocks:** nothing · **Severity:** low

The "Outcome reporting" artboard specifies a fourth option under *which one did
you send?* — **"I sent something else"**. It is not in the shipped form.

`outcomes.sent_item_id` is `uuid not null references ranking_items(id)`, and
`/api/outcome` rejects a request without it. There is no way to record "they sent
a line that is not in this comparison" without a migration.

It was omitted rather than faked. The alternative was to show the option and have
it fail on submit, or to silently attach the report to the wrong line — both
worse than not offering it.

**Why it matters more than it looks.** The person most worth hearing from is the
one who read the ranking, disagreed, and sent something else entirely. The current
form can only collect outcomes from people who did what they were told, which
biases the outcome corpus toward agreement — in the one dataset that exists to
test whether the model is right.

**To resolve:** make `sent_item_id` nullable, add a `sent_other_text` column, or
add a nullable free-text field. One migration and a small API change.

---

## Q-009 — Most reasons cannot be traced to specific words

**Raised:** 2026-08-28 · **Status:** OPEN · **Blocks:** nothing · **Severity:** low

`marksFor` draws marks for three things: second-person pronouns, a *leading*
demonstrative, and terminal punctuation. The model uses 48 features, so most
reasons carry no mark and show no "marked in the line above".

A concrete miss from a real comparison: *"The one chart that explains your churn"*
gets the reason **demonstratives · this line 1 · your others 0**. The
demonstrative is *that*, mid-line, and no mark is drawn because the marking rule
only ever looks at the first token. The reason is true and the word it refers to
is right there, unmarked.

The eight `ft_*` first-token features are the clearer case: they are *about* the
first token, which is always a concrete span, so they are markable with near
certainty and currently are not.

Not a correctness problem — nothing false is drawn, and the "marked in the line
above" affordance correctly does not appear when there is no mark. It is a gap
between what the reasoning surface promises and what it delivers, on the surface
the brief calls the second most important in the product.

**To resolve:** extend `marksFor` to (a) any demonstrative rather than only a
leading one, and (b) the first token when an `ft_*` feature is among the shown
reasons. Both need corpus cases that would fail if the offsets were wrong, per
the standing rule in CLAUDE.md.

---

## Q-010 — The Apple Mail chips are stored as band midpoints

**Raised:** 2026-08-28 · **Status:** OPEN · **Blocks:** nothing · **Severity:** low

`/api/outcome` takes `appleMailShareEstimate` as a fraction between 0 and 1. The
form asks a deliberately vague question with four answers, so each is mapped to a
midpoint: *under a quarter* → 0.125, *about half* → 0.5, *most of it* → 0.8,
*no idea* → not sent.

Those midpoints are **derived, not stated**. Nobody said 0.125. The band the
person actually chose is written verbatim into `notes` as
`apple_mail_share_band=<id>` so the raw answer survives alongside the figure, and
any later analysis can use whichever it wants.

Flagged because a float in a database column looks like a measurement, and in six
months the `0.125` will look like something a user typed. If that risks being
misread, the cleaner fix is a `text` band column and no float at all — the
midpoints were chosen to fit an API that already existed rather than because a
midpoint is the right summary of "under a quarter".

---

## Q-011 — Half the D-006 benchmark is measured; the Azure half is not  
**RESOLVED 2026-09-05.** All three targets measured; see EXPERIMENTS.md. The latency argument in D-006 did not survive: warm p50 is a wash and the separate service has a ~3x better p90. The defensible reason for the in-process design is operational surface, not speed.

**Raised:** 2026-09-03 · **Status:** OPEN · **Blocks:** nothing · **Severity:** low

D-031 built the harness that finally puts a number on D-006's assumption that
in-process ONNX beats a managed inference service for this workload. One side of
the comparison has run:

| | p50 | p90 | p99 | first request | errors |
|---|---:|---:|---:|---:|---:|
| production container image, warm | 45.45 ms | 70.11 ms | 101.97 ms | 187.97 ms | 0/120 |

The Azure ML managed online endpoint has **not** been deployed, so there is no
second column and no verdict. `azure/bench/report.mjs` prints "No verdict yet"
rather than a table with one row dressed up as a comparison.

**Why it is not done.** It needs a live Azure subscription, and the endpoint is
the one resource in this project that bills continuously while idle — so it
should be created, measured and deleted in one sitting rather than left standing.

**Two things to be careful about when it does run:**

1. **"Cold start" is not the same measurement on both sides.** Container Apps at
   `minReplicas: 0` genuinely scales to zero; an online deployment at
   `instance_count: 1` does not. Quoting the two first-request numbers side by
   side without saying which was actually cold would be a real overstatement.
   The harness records a `--note` for exactly this and the report reprints it.
2. **A latency win would not settle it.** `score.py` uses the Python extractor
   because it cannot import the TypeScript one, so an endpoint architecture adds
   a third implementation boundary for the parity suite to police. That cost is
   real and appears in no table.

**To resolve:** the commands are in `azure/README.md` under "The benchmark", and
`docs/DEPLOY.md` sequences them inside a single time-boxed Azure session so the
endpoint is created, measured and deleted without leaving a meter running. Then
append the result to `EXPERIMENTS.md` and replace the "no Azure column" note in
D-031 with the number.

---

## Q-012 — Most reasoning is not traceable to a character span

**Status:** open. Found 2026-09-05 while mutation-testing the inference-mode gate.

The product's stated requirement is that reasoning be "traceable to the specific
part of the text the person wrote". In practice, across 7 comparison cases, only
**3 highlights** were produced in total, and both came from terminal punctuation.

A case built specifically to trigger them — `5 WAYS to fix onboarding TODAY`,
carrying a leading digit and two ALL-CAPS words — produced **no marks at all**.

The mechanism is consistent, not broken: `marksFor` only marks features that
appear in the notes actually shown, and the top reasons for that line were
length- and word-count features, which genuinely have no specific characters to
point at. A length reason cannot honestly highlight a span.

So the question is not "why is this failing" but **whether the interface
overclaims**. If most comparisons show three reasons and none of them can be
traced to text, then "inspectable, traceable reasoning" describes the mechanism's
best case rather than its usual one.

Two honest options, neither yet chosen:
1. Say plainly when a reason applies to the whole line rather than a part of it,
   so the absence of a highlight reads as information rather than an omission.
2. Narrow the claim in the copy to what the mechanism does most of the time.

What must NOT happen is inventing spans for length features to make the
interface look more inspectable than it is.

---

## Q-013 — Training is not bit-reproducible across machines, and one claim was made before checking

**Status:** open (as a documented limit, not a defect). Found 2026-09-05.

The Azure ML run and the local run agree on every number the job log prints, and
on every gate outcome. They do **not** produce byte-identical ONNX graphs:

```
export fidelity max abs delta   local 1.0238653014305044e-07
                                azure 1.0238639880366662e-07   (1.28e-06 relative)
graph sha256                    local d2f9b8f6...  azure 9fe45313...
```

Ordinary cross-platform floating-point nondeterminism — different BLAS, different
summation order in the same solve. It changes no decision: a ~1e-13 relative
difference in coefficients cannot reorder two lines that `TOO_CLOSE_THRESHOLD`
would not already call a tie.

**Two things to decide.**

1. Does anything downstream want byte-identical artifacts? Caching a promoted
   graph by hash across environments, or a reproducible-build claim, would both
   break on this. Nothing does today. If something starts to, the answer is
   thread-pinning and a fixed BLAS, not pretending the pins are enough.

2. `artifact_sha256` is a registry tag. Two runs of the *same* code on different
   machines now produce different hashes, so that tag identifies a build, not a
   model. Worth stating in the model card before someone reads a hash mismatch as
   evidence the code changed.

**Why this is in here rather than just fixed.** The first write-up of this run
claimed the numbers were identical — "not close, the same numbers" — on the
strength of a log that rounds to four significant figures. The full-precision
values were sitting in the registered model's tags. The claim was checked at the
precision that happened to be printed, which is the same shape of mistake as
trusting a metric because it appeared in an output rather than because it was
measured at the resolution the claim required.

---

## Q-014 — Two quota pools, one silent nine-hour stall

**Status:** open (operational). Found 2026-09-05.

`cpu-cluster` is `Standard_DS3_v2` and reserves 4 of the 6 vCPUs allowed in the
**DSv2 family**. A managed online deployment reserves **twice** its instance size
for rollout headroom, so a `Standard_DS2_v2` endpoint needs 4 more. `4 + 4 > 6`:
the training cluster and the benchmark endpoint could never both exist.

**The failure is not symmetric, and that is the dangerous part.**

* When the *endpoint* asks second, it fails immediately and says exactly why:
  `Not enough quota available for Standard_DS2_v2. Current usage/limit: 4/6.`
* When the *training job* asks second, it sits `Queued` indefinitely — nine hours,
  in this case — while the cluster reports `allocationState: Steady`,
  `targetNodeCount: 0`, `currentNodeCount: 0` and **no error field at all**.
  Nothing anywhere says "quota". `az ml job show` reports only `Queued`.

Fixed for now by moving the endpoint to `Standard_F2s_v2` (FSv2 family, a
separate pool at 0 of 6), so the two never compete. That is the right fix and it
is not a complete one:

1. **The silent-stall failure mode still exists** for any future compute that
   lands back in a contended family. There is no check that would catch it. A
   pre-flight quota assertion before submitting a job would turn nine hours of
   silence into an immediate error naming the family.
2. **`min_instances: 0` does not release the reservation.** The cluster holds its
   4 vCPUs whether or not a node is running, which is invisible in the usage
   table — `current=4` reads identically whether the cluster is idle or busy.
   That is what made this misdiagnosable, and it was misdiagnosed twice before
   the endpoint's own error settled it.

**Worth writing down about the diagnosis, not just the bug.** The first reading
blamed quota, the second reading retracted that after seeing `current=4` unchanged
once the endpoint was deleted, and the retraction was itself wrong. The unchanged
`4` was the cluster's own standing reservation and said nothing either way. A
number that looks like evidence for both answers is evidence for neither.
