# RUNBOOK

Operational reference. Written to be usable at 3am by someone who did not write
the code.

---

## 0. Environment

| | |
|---|---|
| Python | 3.10, venv outside the repo (see §6 for why) |
| Node | 22 |
| Install | `pip install numpy scipy pandas scikit-learn lightgbm onnx onnxruntime skl2onnx onnxmltools matplotlib pytest` |
| Web deps | `cd web && npm install` |

---

## 1. Get the data

Manual, by design — OSF is unreachable from the build environment (D-001).
Full instructions: `docs/GET_THE_DATA.md`. Drop the CSVs unmodified into
`data/raw/`.

The loader asserts each file against the published counts in Matias et al.
Table 1. **A count mismatch stops the run.** That is correct behaviour: it means
the file is truncated or is not what it claims, and both are reasons to stop.

---

## 2. Train locally

```bash
python -m subjectrank.train              # full run
python -m subjectrank.train --quick      # one CV fold, for wiring checks
python -m subjectrank.train --alpha 0.05 # override the z-test threshold
```

Writes `ml/reports/run_<id>.json` containing config, environment, the full filter
ledger, the alpha sweep, per-feature support, CV results and holdout results.

Then:

```bash
python ml/scripts/write_model_card.py    # regenerates MODEL_CARD.md from that run
```

Never hand-edit `MODEL_CARD.md`. Every number in it is read from the run report so
that it cannot drift from what was actually measured.

---

## 3. Verify before deploying

All four must pass. Any failure is a block, not a warning.

```bash
pytest ml/tests -q                                    # invariants + pipeline smoke
cd web && npx tsx ../parity/run_parity.ts             # Python/TypeScript parity
python parity/mutation_check.py                       # proves the parity suite can fail
python ml/scripts/gen_ts_lexicons.py --check          # lexicon drift
```

**Why the mutation check matters:** a parity suite that has never failed is not
evidence of parity. `mutation_check.py` injects eight plausible bugs into the
TypeScript extractor and asserts each is caught. If one survives, the corpus has a
blind spot — add a case to `ml/scripts/build_parity_corpus.py`, do not lower the
tolerance.

---

## 4. Roll back a model

Models are versioned in the `models` table with status champion/challenger/archived.

1. `UPDATE models SET status='archived' WHERE status='champion';`
2. `UPDATE models SET status='champion' WHERE version='<known good>';`
3. Redeploy so the serving function picks up the artifact.
4. Record in `EXPERIMENTS.md` what was rolled back and why. A rollback is data.

**Never** serve a model whose `feature_spec_version` differs from the extractor's.
The server refuses to start in that case rather than serving silently-wrong
numbers, and that refusal is intentional — do not patch around it.

---

## 5. Reading the drift dashboard

PSI and KS per feature, live inputs vs the training distribution.

**Expect this to fire immediately and dramatically.** User subject lines will not
look like 2013–2015 Upworthy headlines: shorter, more emoji, more punctuation,
less curiosity-gap phrasing. That is the finding, not a bug. A monitoring system
that detects a real distribution shift on day one is a better story than one that
reports green.

What would actually be alarming:

- A feature's live distribution *collapsing* (e.g. `char_count` variance → 0) —
  usually a truncation bug in the client, not a user-behaviour change.
- Predicted probabilities piling up at 0.5 — the model has stopped discriminating.
- Sudden change with no matching change in traffic — check the deploy log first.

---

## 6. Responding to a bad-prediction report

Every ranking has a one-click "this is wrong" control writing to `feedback`.

1. Pull the `ranking_items` row; you have the exact input text, the extracted
   features, the model version and the pairwise confidences.
2. Re-run the extractor on that text locally. If the features differ from what was
   stored, that is a **serving skew bug** — the parity suite missed something, and
   the first fix is a new corpus case.
3. If the features match, it is a model disagreement, not a bug. Those accumulate
   into the challenger's evaluation set.
4. High-confidence disagreements are the most valuable: a wrong answer the model
   was sure about is a calibration failure and should be checked against the
   reliability curve.

---

## 7. Where every secret lives

| secret | where | notes |
|---|---|---|
| `SUPABASE_URL` | Vercel env, all environments | public, safe in client bundle |
| `SUPABASE_ANON_KEY` | Vercel env, all environments | public by design; RLS is what protects data |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env, **server only** | never in a client bundle, never `NEXT_PUBLIC_` |
| `CRON_SECRET` | Vercel env, server only | guards `/api/cron/*` |
| GitHub Actions → Supabase | repo secrets | for the retraining job |

If a service-role key is ever exposed, rotate it in Supabase first, then update
Vercel, then redeploy. Rotating in the other order leaves a live window.

---

## 8. Known local-environment quirk

The build ran through the Cowork device bridge, which blocks `unlink()` inside
connected folders. Git could not delete its own `index.lock` after the first
commit and the repository jammed. Work continued against a git dir in session
scratch with the work tree pointing at the project folder.

**Before pushing, restore the real `.git`** — see `MORNING.md` step 1. Nothing is
wrong with the history; it just lives in the wrong place until then.
