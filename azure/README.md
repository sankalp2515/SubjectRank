# SubjectRank on Azure

> **Not the free-tier path.** If the constraint is "no pay-as-you-go", deploy on
> Vercel Hobby + Supabase Free and use Azure as a time-boxed session inside
> trial or student credit. See `docs/DEPLOY.md`.

What each service does, why it is here, and what it costs. Read the cost section
before running anything.

The architecture rationale is D-029 to D-031 in `DECISIONS.md`. The short
version: Azure fills the parts of this project that were genuinely weakest — it
was not deployed anywhere, training was a local script with no lineage, and
promotion was `shutil.copy2`. Anything Azure would only have duplicated was left
alone, and that list is as important as this one.

| service | what it does here | why not something else |
|---|---|---|
| **Container Apps** | Runs the Next.js app, scale-to-zero | App Service has no scale-to-zero; a portfolio app with no traffic should cost nothing |
| **Container Registry** | Holds the image | Admin user disabled — the app pulls with its own managed identity |
| **Azure ML** | Training jobs, metrics, model registry, champion alias | This replaced a script that copied a file |
| **Blob Storage** | The archive and every artifact, versioned, hashed | The bytes every metric depends on lived on one laptop (D-001's concern, one layer up) |
| **Log Analytics + App Insights** | Container and job logs | — |
| **Supabase** *(unchanged)* | Postgres, auth, RLS | **Deliberately not migrated** — see D-029 |

---

## Cost, honestly

Everything here is small, but two things bill whether or not you use them.

* **Container Apps at `minReplicas: 0`** costs essentially nothing while idle. It
  is the cheapest piece.
* **Blob, Log Analytics** — pennies at this volume.
* **Azure ML workspace** brings a Key Vault, an App Insights and a storage
  association. The workspace itself is not the expense; **compute is**. The
  cluster in `compute.yml` is `min_instances: 0` and scales down after 120s
  idle, so it bills only while a job runs.
* **A managed online endpoint bills continuously while it exists**, even with
  zero requests, because `instance_count: 1` means an instance is always up.
  This is the one thing here that will quietly cost money. It is used for the
  D-031 benchmark and **deleted immediately afterwards**. The teardown command is
  at the bottom of this file.

Check current pricing before running — these are shapes, not quotes. Free-trial
or student credits cover this comfortably for learning, provided the endpoint
does not get left running.

---

## Two things this subscription actually hit

**`westeurope` refused every resource.** `RequestDisallowedByAzure` — "the
selected region is currently not accepting new customers". That is a region
eligibility limit, not a quota; retrying never clears it. Probed `eastus`,
`centralindia`, `uksouth`, `northeurope` and `westus2` — all five eligible. The
default is now `centralindia`; override with `LOCATION=<region>`.

The template-validate step in `deploy.sh` caught this **before creating
anything**, which is exactly what it is there for.

**The Container Apps environment can lose an ARM race.** A managed environment
takes several minutes to provision, and the first deployment reported
`ResourceNotFound` for it while the container app tried to attach — even though
`managedEnvironmentId: caEnv.id` declares the dependency. The environment
finished provisioning successfully a moment later. `deploy.sh` is idempotent, so
the fix is to run it again; the second pass finds the environment and continues.

**`Microsoft.MachineLearningServices` was not registered** on this subscription.
Registering it is a one-off:

```bash
az provider register -n Microsoft.MachineLearningServices
```

---

## One-time setup

```bash
# 0. Prerequisites
az login
az account set --subscription <SUBSCRIPTION_ID>
az extension add --name ml
RG=subjectrank-rg
az group create -n $RG -l westeurope
```

```bash
# 1. Infrastructure. Edit azure/infra/main.parameters.json first — at minimum
#    sessionSecret, which the app refuses to start without in production.
#    Generate one with: openssl rand -base64 32
az deployment group create -g $RG \
  -f azure/infra/main.bicep \
  -p @azure/infra/main.parameters.json \
  --query properties.outputs
```

Keep those outputs. They are the values for the GitHub variables below.

```bash
# 2. The archive, with its checksums recorded.
python ml/scripts/upload_archive.py --account <storageAccountName> --container archive
```

```bash
# 3. Training compute, then the run.
az ml compute create -f azure/ml/compute.yml -g $RG -w <mlWorkspaceName>
az ml job create   -f azure/ml/train_job.yml -g $RG -w <mlWorkspaceName>
```

The job runs the same pipeline as `python -m subjectrank.train`, logs every
metric to MLflow, and registers each model with its gate results as tags. A model
that fails the export gate is registered with `gate_passed=false` rather than
hidden — `candidate_lgbm` is expected to be one of those (D-026).

```bash
# 4. Promote. Explicitly — see the note in azure/ml/promote.py about why this is
#    not automatic.
python azure/ml/promote.py --show
python azure/ml/promote.py --model baseline_logreg
```

```bash
# 5. GitHub OIDC, so CI never holds a password.
#    Create an app registration, federate it to this repo, give it AcrPush on the
#    registry, Contributor on the resource group, and AzureML Data Scientist on
#    the workspace. Then set, in the repo:
#      secrets: AZURE_CLIENT_ID, AZURE_TENANT_ID
#      vars:    AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, AZURE_ML_WORKSPACE,
#               ACR_NAME, CONTAINER_APP
```

Push to `main` and `deploy.yml` runs the gates, fetches the promoted champion,
bakes it into the image, deploys, and then **verifies the live revision is
serving that exact sha256** before it reports success.

---

## The benchmark (D-031)

D-006 chose in-process ONNX over a separate inference service on cold-start and
cost grounds, and never measured it. This measures it.

```bash
az ml online-endpoint   create -f azure/ml/endpoint.yml   -g $RG -w <ws>
az ml online-deployment create -f azure/ml/deployment.yml -g $RG -w <ws> --all-traffic

KEY=$(az ml online-endpoint get-credentials -n subjectrank-bench -g $RG -w <ws> --query primaryKey -o tsv)
URL=$(az ml online-endpoint show -n subjectrank-bench -g $RG -w <ws> --query scoring_uri -o tsv)

node azure/bench/benchmark.mjs \
  --target aca=https://<app>.azurecontainerapps.io \
  --target amlep=$URL --key $KEY \
  --n 200 --concurrency 4 \
  --note "ACA at minReplicas=0 idle >5min; AML endpoint instance_count=1, warm"

node azure/bench/report.mjs      # renders the table; refuses without a run
```

**Then delete it.** This is the only resource here that bills while idle:

```bash
az ml online-endpoint delete -n subjectrank-bench -g $RG -w <ws> --yes
```

The benchmark records the ranking each target returns and fails if they disagree.
If two serving paths rank the same four lines differently, that matters more than
any latency difference and the report leads with it.

---

## Teardown

```bash
az ml online-endpoint delete -n subjectrank-bench -g $RG -w <ws> --yes   # first
az group delete -n $RG --yes --no-wait                                   # everything
```

The Key Vault is soft-delete enabled with 7-day retention, so re-deploying to the
same name inside a week needs `az keyvault purge`.

---

## What is deliberately not here

* **No Azure Database for PostgreSQL.** Supabase already holds the schema, the
  RLS policies and a script that asserts the RLS is really on. Re-implementing
  that to arrive at the same place is churn (D-029).
* **No Azure OpenAI, no Cognitive Services.** Nothing in this product calls an
  LLM. Adding one to have a fashionable service on the diagram is the resume
  padding this whole project argues against.
* **No AKS.** One container with no traffic does not need a Kubernetes cluster,
  and saying so is a better answer than running one.
