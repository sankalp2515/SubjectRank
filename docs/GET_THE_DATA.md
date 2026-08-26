# Getting the Upworthy Research Archive

**Status: BLOCKED — needs Sankalp. Nothing downstream can run until this is done.**

## Why you and not the agent

`osf.io`, `files.osf.io`, `zenodo.org`, `huggingface.co` and `kaggle.com` all fail
DNS/TLS from both this session's cloud container and the desktop shell. Only
`github.com`, `pypi.org` and `registry.npmjs.org` are reachable. Third-party GitHub
copies of the archive exist and were located, but you chose canonical provenance
over convenience. That is recorded as D-001 in `DECISIONS.md`.

## What to download

Go to <https://osf.io/jd64p/> — "The Upworthy Research Archive".

Download **at minimum** the exploratory dataset:

| File | Approx. size | Contains |
|---|---|---|
| `upworthy-archive-exploratory-packages-03.12.2020.csv` | ~14 MB | 4,873 tests / 22,666 packages |

If — and only if — the confirmatory and holdout sets are downloadable to you without
an approved analysis plan, take these too:

| File | Approx. size | Contains |
|---|---|---|
| `upworthy-archive-confirmatory-packages-03.12.2020.csv` | ~66 MB | 22,743 tests / 105,551 packages |
| `upworthy-archive-holdout-packages-03.12.2020.csv` | ~14 MB | 4,871 tests / 22,600 packages |

Do **not** click through any access agreement that commits you to a pre-registered
analysis plan in order to get the confirmatory set. See Q-001 in `OPEN_QUESTIONS.md`
— this materially changes what we are allowed to claim, and it is not a decision to
make at 2am on a job application.

## Where to put them

Drop the CSVs, unmodified and unrenamed, into:

```
E:\Claude Code Projects\ML Model\subjectrank\data\raw\
```

Then say "data's in" and the pipeline picks up from there. First thing it does is
profile the file and assert the published counts (4,873 tests / 22,666 packages for
exploratory). If the counts or schema don't match, it stops rather than improvising.

## Licence and attribution — mandatory

CC BY 4.0. Attribution is required in `README.md`, `MODEL_CARD.md`, and visibly in
the app footer:

> Matias, J.N., Munger, K., Le Quere, M.A. et al. The Upworthy Research Archive, a
> time series of 32,487 experiments in U.S. media. *Sci Data* **8**, 195 (2021).
> https://doi.org/10.1038/s41597-021-00934-7
