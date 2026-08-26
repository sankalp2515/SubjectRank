# OPEN QUESTIONS

Things the agent was unsure about and did **not** silently guess. Sankalp reads this
first. Each entry states what is uncertain, why it matters, what was done in the
meantime, and what decision is needed.

---

## Q-001 — Is the confirmatory dataset actually open, and does §14's "32,487" survive?

**Raised:** 2026-08-26 · **Status:** OPEN · **Blocks:** the §14 claim, not the build

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
