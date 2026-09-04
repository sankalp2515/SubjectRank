# Running SubjectRank

## One command

```bash
npm run up
```

Then open **http://localhost:3000**.

That builds the image and waits until the app can actually serve a ranking — not
until the process is listening. The readiness probe loads the ONNX session, so
`Healthy` means the model is readable and inference works.

| command | what it does |
|---|---|
| `npm run up` | build + start, wait for healthy |
| `npm run down` | stop |
| `npm run logs` | follow the app log |
| `npm run health` | which model is live, and its sha256 |
| `npm run order` | paste-order invariance against localhost:3000 |
| `npm run gates` | the full pre-deploy suite |
| `npm run deploy:azure` | provision and deploy to Azure (needs `az login` first) |

Requires Docker Desktop running. `docker compose up --build` works too — the npm
script only adds `--wait`.

---

## Is Docker actually used here?

Yes, and it is the same image in all three places:

* `npm run up` locally,
* `az acr build` during `azure/deploy.sh`,
* the `deploy.yml` GitHub Actions workflow.

One `web/Dockerfile`, one artifact. There is no separate "dev container" that can
drift from what ships.

**Vercel is the exception and does not use Docker** — it builds its own function
bundle. That is why `output: 'standalone'` in `next.config.mjs` is gated behind
`BUILD_TARGET=container`, which only the Dockerfile sets. Both targets are
exercised so neither rots quietly.

---

## Running without Docker

```bash
cd web
npm ci --ignore-scripts
SESSION_SECRET=dev npm run dev      # http://localhost:3111
```

Faster to iterate on, and it is **not** what deploys. Use `npm run up` before
believing anything about production behaviour.

---

## What persists, and what does not

With no Supabase credentials the app runs on its in-memory data layer. It ranks
correctly, the whole UI works, and **nothing survives a restart** — no rankings,
no funnel events, no disagreements, no reported outcomes. The app logs a warning
saying exactly this rather than failing quietly.

To persist, put both in a `.env` file next to `docker-compose.yml`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

`docker-compose.yml` reads that file automatically. Also set `ADMIN_TOKEN` if you
want `/admin` to exist; without it that route 404s in every environment, which is
the right default for a page that renders other people's text.

---

## Seeing the parts that need a model

* **http://localhost:3000** — the product. Paste 2–5 lines, press Compare.
* **http://localhost:3000/api/health** — the live model version and sha256.
* **http://localhost:3000/dev/preview** — the comparison surface rendered from
  invented numbers, for looking at states that are hard to trigger on demand.
  404 in production, and it says on the page that the numbers are made up.

To see the honesty feature — the case the whole design turns on — paste these
three and press Compare:

```
What nobody tells you about churn
What nobody tells you about renewals
We looked at 400 churn surveys
```

The model separates the third from the other two and **cannot separate the first
two from each other**, so they both read `2nd–3rd` with a strip between them
saying so, instead of being put in an order the evidence does not support.
