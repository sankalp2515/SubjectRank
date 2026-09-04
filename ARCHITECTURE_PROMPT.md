# Claude Code prompt — architecture, system design, and the frontend brief

Paste everything between the fences into Claude Code, running in this repo.

The frontend section deliberately states **what the interface has to do and be
true about**, and says nothing about how it should look. Palette, type, layout,
composition, motion and component structure are yours to decide.

---

```
Read CLAUDE.md, DECISIONS.md and OPEN_QUESTIONS.md before writing anything. They are
the working agreement and they override your defaults.

===============================================================================
PART A — WHAT THE SYSTEM IS
===============================================================================

SubjectRank. A newsletter operator pastes 2–5 email subject lines and gets them
ranked against each other, with the reasoning traceable to specific parts of the
text they wrote.

The problem is framed as PAIRWISE RANKING, not pointwise scoring, and this is the
decision the whole architecture follows from:

  - The user's real question is "which of these should I send", not "what will my
    open rate be".
  - Absolute click-through rate in the training data is dominated by test-level
    effects — the story, the image, the day, the audience — none of which a subject
    line controls. Differencing two arms within the same test cancels every one of
    them.
  - The training domain (2013–2015 US viral media headlines) is not the serving
    domain (2026 email subject lines). Absolute levels certainly do not transfer.
    The direction of feature effects plausibly transfers better. Ranking is the
    framing that only needs the weaker claim.

So the model predicts P(A beats B) from the feature DIFFERENCE vector x_A − x_B, and
is structurally incapable of producing an absolute rate. That is a property to
preserve, not an inconvenience to work around.

===============================================================================
PART B — SYSTEM DESIGN
===============================================================================

Five subsystems. Read the existing code in each before changing it.

--- 1. DATA PIPELINE (ml/subjectrank/data.py, labels.py, splits.py) ------------

Source: the Upworthy Research Archive — randomised A/B tests of headlines with real
click outcomes, CC BY 4.0. Attribution is mandatory in README, model card and app
footer.

Stages, each of which logs what it cost:

  load → assert published row counts → drop invalid outcomes → drop the archive's
  own randomisation-failure flag → aggregate duplicate rows per (test, image,
  headline) → drop arms below an impression floor → build pairs → label → split

Two filters do the real work and neither may be relaxed:

  a) PAIRS MUST SHARE AN IMAGE. Upworthy varied headline AND image within a test, so
     a CTR difference between arms with different images is a joint effect.
     Attributing it to the headline is simply wrong. This costs most of the data.
     The surviving count is a reported number, not an implementation detail.

  b) PAIRS MUST BE STATISTICALLY DISTINGUISHABLE. A two-proportion z-test; pairs
     that fail are dropped rather than labelled by sign. Many arms have small
     exposure where the observed ordering is mostly noise, and labelling those
     teaches the model to predict coin flips. The threshold is swept, not chosen
     once.

Leakage control is structural rather than procedural:

  - The feature extractor takes a single string and nothing else, so it cannot see a
    dataset column. `impressions` in particular encodes both the outcome and the
    stopping decision — editors halted tests once a winner emerged.
  - Splits group on test id. Arms from one test share a story, an image, an editor
    and a day; a row-level split puts near-duplicates on both sides.
  - The final number comes from a TIME-FORWARD holdout, not the group split,
    because editorial style drifted across the training period and the deployed
    model faces text from a decade later. Report both and explain the gap.

--- 2. TRAINING (ml/subjectrank/models.py, train.py, evaluate.py) --------------

Three models, no more: a logistic-regression baseline, a gradient-boosted
candidate, and a TF-IDF variant that exists to be evaluated and documented.

The baseline is antisymmetric BY CONSTRUCTION — no intercept, scaling without
centring — so f(d) + f(−d) = 1 exactly. The tree ensemble is antisymmetric only as
far as data augmentation pushed it. That difference is a deployment gate: if the
ranking can change when the user reorders their inputs, the tool is broken in a way
no accuracy number rescues.

Four metrics, always reported together:
  1. pairwise accuracy and ROC-AUC on held-out tests
  2. top-1 selection accuracy — given all arms of an unseen test, is the true winner
     chosen? This is what the product does, so it leads. The baseline is 1/n_arms,
     never 50%.
  3. realised CTR lift of the chosen arm vs the mean arm. Assignment was randomised,
     so this is causal WITHIN THE TRAINING DOMAIN and nowhere else.
  4. calibration — reliability curve and Brier. Any confidence the interface
     communicates is only honest if these probabilities mean what they say.

Features whose support in the training pairs is negligible are DROPPED from the
model rather than shipped with a coefficient fitted on almost nothing.

--- 3. SERVING (web/src/lib/model.ts, features.ts, attribution.ts) ------------

The model exports to ONNX and runs in a Node serverless function. No Python service,
no second host, no cost. Feature extraction therefore happens in TypeScript at
request time while training happened in Python.

That is training/serving skew by construction, and the mitigation is the part of
this project worth defending in an interview:

  - The feature set is specified once, language-neutrally, in docs/FEATURES.md.
    Neither implementation is the reference; that document is.
  - Every lexicon exists once, as JSON. The TypeScript copy is generated and CI
    fails on drift.
  - A frozen adversarial corpus is run through both extractors and compared
    element-wise: Unicode normalisation forms, ZWJ emoji sequences, regional-
    indicator flags, non-ASCII decimal digits, Turkish and Greek casing, curly
    apostrophes, zero-width characters.
  - A mutation tester injects known bugs into the TypeScript extractor and asserts
    the suite catches each one. A parity suite that has never failed is not evidence
    of parity — one real divergence already shipped past it because every non-ASCII
    digit in the corpus happened to be 1, 2 or 3.

Attribution is computed SERVER-SIDE and shipped with the result. For the linear
model a feature's contribution is exactly coefficient × scaled difference — the
explanation is the model, not a story about the model. Model weights never reach the
browser.

A model trained under one feature-spec version may not be served by an extractor at
another. The server refuses to start rather than serving silently-wrong numbers.

--- 4. PERSISTENCE AND IDENTITY (web/src/lib/data/*, session.ts) --------------

The data layer sits behind one interface with two implementations — in-memory and
Postgres — selected by environment. Nothing above it knows which is live.

Identity is a signed httpOnly cookie. It is deliberately NOT derived from the
database client: doing that silently replaced the server's credential with a
visitor's, raced concurrent requests into each other's identity, and minted a new
user per request, which made rate limiting a no-op. Server-side writes use a
credential that bypasses row-level security, so ownership is checked in application
code before every write — a foreign key only proves an id exists.

Row-level security is on for every user-scoped table and a migration ASSERTS it:
it raises if any public table has RLS off, if an RLS-enabled table has no policies,
or if a user-scoped table has an unconditional read policy. The public key ships in
the browser; RLS is the only thing between it and everyone's data.

Stored: the lines submitted, extracted features, scores and ranks, disagreement
signals, and user-reported outcomes. Those lines ARE the future training set, which
is the point of the tool — so the interface says so plainly and deletion is one
action.

--- 5. MONITORING AND RETRAINING (ml/subjectrank/drift.py, retrain.py) --------

Drift: PSI and KS per feature, live inputs against the training distribution. Bin
edges come from TRAINING and are applied to live data — binning on the combined data
would move as live data arrives and understate the shift.

Expect this to fire immediately and dramatically. 2026 email subject lines do not
look like 2013–2015 viral headlines. That is the finding, not an incident. What
would actually be alarming is predicted probabilities collapsing toward 0.5, which
means the model has stopped discriminating; that has its own detector.

Retraining is champion/challenger. A challenger is promoted only if it wins on BOTH
the frozen holdout AND user-reported labels. Winning on the holdout alone selects
for fitting the past harder; winning on a handful of self-reports alone is more
likely noise. Correctness gates accuracy: a model that violates antisymmetry is not
a candidate however accurate it is. A rejected challenger gets documented.

--- DEPLOYMENT ---------------------------------------------------------------

Everything runs on free tiers. Training and retraining in CI, inference in
serverless functions, scheduled monitoring on cron, Postgres and auth managed. If a
step would require a paid upgrade, stop and say so rather than designing around it.

===============================================================================
PART C — THE FRONTEND
===============================================================================

The visual direction is YOURS. Use your design judgement and your design skills.
I am specifying what the interface must do and what must be true of it, and nothing
about how it should look.

Ignore docs/DESIGN_DIRECTION.md and the existing components under
web/src/components — that is an earlier direction and a working reference for the
BEHAVIOUR only. Replace the presentation layer entirely. Keep web/src/lib/* and
web/src/app/api/* — those are tested and the API contract is settled.

WHO IT IS FOR
Newsletter operators and indie founders who have seen fifty AI tools this month and
are tired of all of them. Skeptical by default. They can smell a template instantly
and they respond to something that looks like a person cared.

THE ONE JOB
Make a skeptical stranger paste their own subject lines within about ten seconds of
arriving.

WHAT IT MUST DO

  1. Take 2–5 subject lines and return them ranked, with per-line reasoning.
  2. Show something real immediately. Time-to-value must not depend on the visitor
     typing anything first — but nothing shown may be fabricated, so if no model is
     deployed the interface says that instead of inventing an example.
  3. Make the reasoning INSPECTABLE, not decorative. A person must be able to trace
     a claim back to the specific part of the line they wrote and judge for
     themselves whether it is fair. A number they are asked to trust is a failure
     here.
  4. Communicate how confident the ranking is. When two lines are statistically
     indistinguishable, the interface must say so rather than presenting a
     confident order — this is the single most important honesty requirement and
     every competing tool gets it wrong.
  5. Let someone disagree in one action, always available, never behind a modal.
     Disagreement is the most valuable signal collected.
  6. Let someone report what actually happened when they sent one: which line, and
     the numbers. Under fifteen seconds, no login required. Collect clicks as well
     as opens — opens are distorted by mail-privacy pixel pre-fetching, and clicks
     are what the training data measured, which keeps reported outcomes and
     training labels comparable.
  7. Offer an account only AFTER a result is on screen, framed as keeping the work
     rather than as a gate.
  8. Provide one-action deletion of everything a person has submitted.
  9. A plain, role-gated admin view: funnel counts, volume, live feature
     distribution against training, disagreement queue, model versions, drift
     status. This one is a tool for me, not a surface for users — spend no design
     effort on it.

WHAT MUST BE TRUE OF IT — these bind the design

  - It must never display a predicted open rate, a score out of anything, or any
    absolute performance number. The model cannot produce one. The interface must
    not imply otherwise even loosely.
  - Where the model has no basis for an opinion — features dropped for lack of
    training support — the interface must SAY SO explicitly. Silence gets filled in
    by the reader. This state must be visibly distinct from "measured, no effect".
  - The limitation must be on the page a first-time visitor sees, not in a footnote
     or a modal: the model learned from 2013–2015 viral media headlines, the user is
     writing 2026 email, absolute performance does not transfer, and the claim that
     effect DIRECTION transfers is a hypothesis rather than a finding. This is a
     trust asset and it is the thing that distinguishes this from every "AI email
     score" tool. It costs conversion and it stays.
  - A ranking must not change if the user reorders their inputs. If the interface
     can ever show two different answers to the same question, nothing else matters.
  - Required attribution for the training data must be visible in the product.
  - It must be honest that submitted lines are stored and become training data.

COPY IS PART OF THE INTERFACE, NOT FILLER
Name things by what the person controls, never by how the system works — nobody is
running inference on a pairwise ranker, they are comparing subject lines. An action
keeps its name through the whole flow. Errors say what happened and how to fix it
and do not apologise. Empty and failure states are moments for direction, not mood.
Write every string; none of it is placeholder.

QUALITY FLOOR — build it in, do not announce it
Works down to 375px, and designed for a phone rather than squeezed onto one — most
community and social traffic arrives on mobile and paste-two-lines works fine there
if the layout was designed for it. Visible keyboard focus on everything focusable.
Reduced-motion respected. Contrast passing AA. Every interactive target reachable by
touch.

Screenshot the result at phone and desktop widths and LOOK at the images before
calling it done. In this codebase that practice has already caught an entire
component silently not rendering, a label class that never existed, and an operator
precedence bug that printed a claim about emoji on lines containing none. Reading
the code caught none of the three.

===============================================================================
HOW TO WORK
===============================================================================

Two rules override everything:

  1. Never fabricate. No invented metric, uplift number, model result or user. If a
     number was not measured it does not appear — not in the UI, not in a document,
     not in a commit message. This has already been violated once in this repo, in
     the code written to prevent it, so treat it as a live risk rather than a
     principle you agree with.
  2. Write down every consequential decision in DECISIONS.md as you make it, with
     the alternative you rejected and why.

If you are unsure whether something is honest, put it in OPEN_QUESTIONS.md rather
than deciding quietly.

Before any deploy, all five must pass:
  pytest ml/tests -q
  cd web && npx tsx ../parity/run_parity.ts
  python parity/mutation_check.py
  python ml/scripts/gen_ts_lexicons.py --check
  cd web && npx next build

Start by telling me your read of the architecture and what you intend to build,
before you build it.
```
