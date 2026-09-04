# SubjectRank web app, for Azure Container Apps.
#
# Two things about this image are decisions rather than boilerplate:
#
#  1. **The champion model is baked in at build time, not fetched at startup.**
#     A container that downloads its model on boot can start successfully and
#     then serve a different model from the one that was tested, and it adds a
#     network dependency to every cold start. CI pulls the model from the Azure
#     ML registry into ./model before this build runs, so the image and the model
#     are one immutable artifact with one sha256. See azure/README.md.
#
#  2. **onnxruntime-node is installed with its native binary intact.** It ships a
#     prebuilt .node addon; `output: standalone` traces it correctly only because
#     next.config.mjs lists the package in serverExternalPackages. The runtime
#     stage copies node_modules/onnxruntime-node explicitly rather than trusting
#     the trace, because a missing .node surfaces at request time as a 500 rather
#     than at build time.

# ---- deps -------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: onnxruntime-node's postinstall fetches from a host that is
# blocked on some networks, and the CPU execution provider it would fetch is
# already in the published package. Documented in HANDOFF (session 1).
RUN npm ci --ignore-scripts

# ---- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The build fails loudly if the promoted model is absent, rather than producing
# an image that boots and then serves the honest "no model deployed" 503 to every
# visitor. A deploy with no model is a deploy failure, not a runtime state.
RUN test -f model/champion.onnx && test -f model/champion.meta.json \
    || (echo "ERROR: web/model/champion.{onnx,meta.json} missing." >&2; \
        echo "CI fetches these from the Azure ML model registry before building:" >&2; \
        echo "  python azure/ml/fetch_model.py --into web/model" >&2; \
        echo "Locally: python ml/scripts/promote_model.py" >&2; exit 1)

# Selects standalone output in next.config.mjs. Vercel builds without it.
ENV NEXT_TELEMETRY_DISABLED=1 BUILD_TARGET=container
RUN npm run build

# onnxruntime-node ships prebuilt native addons for darwin, linux and win32. A
# Linux container can load exactly one of them, and the other two were 216 MB of
# an 833 MB image. This is not an optimisation trick: a runtime image carrying
# binaries it is structurally incapable of executing is simply wrong, and every
# pull pays for it.
#
# It happens HERE, in the build stage, and not after the runtime COPY. Layers are
# additive, so deleting a file in a later layer leaves it in the earlier one and
# reclaims nothing -- the first attempt at this changed the image size by 1 MB in
# the wrong direction.
#
# The guard makes a package-layout change fail the build rather than silently
# shipping the full set again.
RUN test -d node_modules/onnxruntime-node/bin/napi-v6/linux     || (echo "onnxruntime-node layout changed; re-check this prune" >&2; exit 1)  && rm -rf node_modules/onnxruntime-node/bin/napi-v6/darwin            node_modules/onnxruntime-node/bin/napi-v6/win32

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# No ./public in this app: the only webfont is fetched from Google Fonts and
# there are no static images. Nothing to copy, so nothing is copied.

# The model, and the native runtime that reads it. Both explicit: see note 1 and
# note 2 at the top.
COPY --from=build --chown=nextjs:nodejs /app/model ./model
COPY --from=build --chown=nextjs:nodejs /app/node_modules/onnxruntime-node ./node_modules/onnxruntime-node
COPY --from=build --chown=nextjs:nodejs /app/node_modules/onnxruntime-common ./node_modules/onnxruntime-common

USER nextjs
EXPOSE 3000

# Container Apps needs a readiness signal that means "can actually serve a
# ranking", not "the process is up". /api/health loads the ONNX session, so a
# container whose model is unreadable never receives traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
