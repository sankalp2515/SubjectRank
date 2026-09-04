# SubjectRank inference API

FastAPI service exposing the pairwise ranker over HTTP.

    POST /v1/compare   {"lines": ["...", "..."]}   -> ranked lines + reasoning
    GET  /v1/health                                -> live model + sha256
    GET  /docs                                     -> OpenAPI UI

## Why this exists, and what it costs

D-006 chose in-process ONNX inside the Next.js function over a separate Python
service, to avoid a second host and a second skew surface. This service is the
other half of that decision made real: it lets the frontend deploy to Vercel
while inference runs on Azure, and it gives the project a documented REST API
rather than a Next route.

**The cost is honest and worth stating.** With inference here, the TypeScript
extractor is no longer on the serving path, so the parity suite stops being a
*serving* guarantee and becomes a specification test. That is a real loss — it
was the strongest engineering claim in the project. What is gained is a single
extractor implementation on the path that matters, which is the other reasonable
way to solve the same problem.

Both paths are kept working. `SUBJECTRANK_API_URL` in the web app selects which
one serves a request, so the two can be compared rather than argued about.
