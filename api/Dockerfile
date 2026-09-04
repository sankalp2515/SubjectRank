# SubjectRank inference API.
#
# Deliberately slim: this image needs the feature extractor and an ONNX runtime,
# and nothing else. pandas, scikit-learn and lightgbm are TRAINING dependencies —
# carrying them into a scoring container adds hundreds of megabytes to serve a
# 2.4 KB model.
FROM python:3.12-slim-bookworm AS runtime

WORKDIR /srv
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# The extractor comes from the training package itself, not a copy. That is the
# whole point of putting inference in Python: one implementation of feature
# extraction on the path that matters.
COPY ml/subjectrank ./ml/subjectrank
COPY shared ./shared
# Copied to api/app, NOT app -- the layout inside the image mirrors the repo.
#
# main.py locates the repo root as parents[2] of its own file, which is correct
# at api/app/main.py and wrong at app/main.py: flattened, parents[2] resolved to
# "/", so sys.path got "/ml" and the import of subjectrank failed at startup.
# Keeping one directory convention removes the class of bug rather than special-
# casing it, and it means a path that works locally works in the container.
COPY api/app ./api/app

# The promoted champion, baked in. A container that downloads its model on boot
# can start successfully and then serve a different model from the one that was
# tested, and it adds a network dependency to every cold start.
COPY web/model ./web/model
RUN test -f web/model/champion.onnx || (echo "champion.onnx missing" >&2; exit 1)

RUN useradd --system --uid 1001 apiuser && chown -R apiuser /srv
USER apiuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/v1/health').status==200 else 1)"

# One worker: the ONNX session is per-process and this workload is CPU-bound on
# a 48-feature linear model. Concurrency comes from Container Apps replicas,
# which is the layer that can actually scale to zero.
CMD ["sh", "-c", "uvicorn api.app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
