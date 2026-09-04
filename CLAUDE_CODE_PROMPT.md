# Kick-off prompt for Claude Code

Open a terminal in `E:\Claude Code Projects\ML Model\subjectrank`, run `claude`,
and paste the block below.

It assumes `data/raw/upworthy-archive-exploratory-packages-03.12.2020.csv` is
already there. If it is not, Claude Code will stop at step 1 and tell you — which is
correct behaviour, not a failure.

---

```
Read CLAUDE.md first, then OPEN_QUESTIONS.md and DECISIONS.md. They are the working
agreement for this repo and they override your defaults.

Context: this is a subject-line ranking tool built as a portfolio artifact for an ML
engineering application. The ML pipeline, the TypeScript/Python feature parity
suite, the Supabase schema, the drift and champion/challenger code, and a working
Next.js app are all built and tested. What is missing is a trained model and two UI
flows. Do not rebuild what exists — read it first.

Work in this order and stop at any step that fails rather than working around it.

STEP 1 — Train and evaluate.

  python -m subjectrank.train

Before you look at a single metric, read the filter ledger and the alpha sweep it
prints. Tell me how many pairs survived the same-image filter (D-003) and how many
survived the z-test, as a table.

Then be suspicious of the results. If top-1 selection accuracy comes back high on
the first run, investigate for leakage BEFORE believing it — check that impressions
are absent from the feature list, that no test id appears in both train and test,
and that the temporal holdout really is time-forward. The guards exist but they were
written by the same person who wrote the pipeline. Report the group-split and
temporal-holdout numbers side by side and explain the gap between them.

Then:
  python ml/scripts/write_model_card.py

Never hand-edit MODEL_CARD.md. If a number is not in the run report, it does not go
in the card.

STEP 2 — Choose the champion, honestly.

Compare baseline_logreg against candidate_lgbm on all four metrics AND on the
antisymmetry violation measured on the exported ONNX graph. D-013 says the baseline
ships unless LightGBM wins clearly, because a tree ensemble's f(d)+f(-d) drifts from
1 and that means two close subject lines can swap winners depending on paste order.
If LightGBM wins by a small margin, ship the baseline and write the rejection down
with the number attached.

Also build and evaluate the TF-IDF variant so the rejection in docs/FEATURES.md §6
is documented with a real margin rather than asserted.

  python ml/scripts/promote_model.py
  python ml/scripts/build_worked_example.py

STEP 3 — Verify. All five must pass; any failure blocks the deploy.

  pytest ml/tests -q
  cd web && npx tsx ../parity/run_parity.ts && cd ..
  python parity/mutation_check.py
  python ml/scripts/gen_ts_lexicons.py --check
  cd web && npx next build

STEP 4 — Build the two missing UI flows.

They are already designed. Read docs/DESIGN_DIRECTION.md for the tokens and open the
canvas at https://claude.ai/code/artifact/3757301f-e84f-452c-8e00-d6e5301b5bf2 —
artboard "Outcome reporting" and artboard "States". Derive every colour and type
decision from the tokens in that doc; do not reach for a default mid-file.

  (a) Outcome reporting. POST /api/outcome already exists and is tested. Build the
      UI: which line did you send (required), clicks and/or opens (either is
      enough), optional list size, and the optional Apple Mail share chips. Under
      fifteen seconds to complete, no login if the session cookie persists.
      Ask for clicks as well as opens on purpose — Apple MPP pre-fetches tracking
      pixels, and clicks are what the training data actually measured, which keeps
      reported outcomes and training labels commensurable. That reasoning belongs in
      the copy, briefly.

  (b) Account upgrade. Offered only AFTER a ranking is on screen, never before,
      never as a modal. Framed as "keep this and track what actually happened".

Add funnel events for both using the existing closed enum in src/app/api/event.

STEP 5 — Look at it.

Screenshot the full flow at 1440px and 375px and actually look at the images. The
last three real bugs in this app were found that way and not by reading code: a
missing sr-only class, an entire component silently not rendering, and an operator
precedence bug that printed "nothing to say about the emoji" on lines with no emoji.
Check horizontal overflow, keyboard focus, and that no note contradicts the text
beside it.

STEP 6 — Report.

Append to EXPERIMENTS.md: run id, data version, hyperparameters, all four metrics on
both splits, promoted or not, and why. Include failures.
Append every consequential choice to DECISIONS.md with the rejected alternative.
Rewrite HANDOFF.md.

Then check §14's sentence in HANDOFF.md clause by clause and tell me which clauses
are now true. Do not soften a clause that is false — delete it.

Two things to hold throughout: never invent a number, and if you are unsure whether
something is honest, put it in OPEN_QUESTIONS.md instead of deciding quietly.
```

---

## If Claude Code stops at step 1

That means the CSV is not in `data/raw/`, or its row counts do not match the
published figures (4,873 tests / 22,666 packages for the exploratory subset). Both
are reasons to stop. See `docs/GET_THE_DATA.md`.

## What NOT to ask it to do yet

- Do not deploy. `MORNING.md` is the credentials checklist and step 1 there
  (restoring the git directory) has to happen first.
- Do not post anything from `launch/LAUNCH_KIT.md`. Every `[BRACKETED]` token in it
  needs filling from the model card first, and Q-001 needs your decision.
