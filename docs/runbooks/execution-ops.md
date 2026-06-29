---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-24
updated: 2026-06-29
---

# Execution Control Staging Operations

<!-- markdownlint-disable MD013 -->

## Boundary

This runbook owns staging deploy, ingress, daily operations, recovery and triage
for the current execution-control + Temporal Docker Compose baseline. It does
not define production substrate, product request truth or Temporal proof
semantics.

Related owner docs:

- current topology: `../architecture/current.md`
- K8s/KEDA target runtime: `../architecture/system/k8s-runtime.md`
- Temporal substrate proof: `temporal-self-host-operations.md`
- product-path smoke: `execution-smoke.md`

## Deploy Checkout And Secrets

`/srv/apps/campus-agent` is a deploy checkout, not a development worktree.
Staging deploys must checkout a pinned release SHA and stay clean.

Required deploy shell env:

```bash
export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=<release-sha>
export EXECUTION_CONTROL_STAGING_EXPECTED_REF=origin/develop
```

`start/status/preflight` fail closed when:

- expected SHA or ref is missing
- `HEAD` differs from the pinned SHA
- tracked files are dirty
- repo-local `.env`, `.env.staging.local` or `apps/app-api/.dev.vars` exists in
  the deploy checkout
- untracked files are outside the allowed staging regex
- the ops-owned runtime env file is missing

If the deploy checkout is dirty, stop the runtime if needed, quarantine the
directory, clone a clean checkout, then deploy the pinned SHA. Do not run a
destructive git reset in the polluted deploy directory and continue.

Runtime env and secret files live outside the repo checkout:

```text
/srv/docker/campus-agent/staging/env/runtime.env
/srv/docker/campus-agent/staging/secrets/*.secret
```

High-sensitivity values should move to Compose `secrets:` where supported.
Values still injected through `runtime.env` must not be copied into the repo.

## Runtime Env Shape

Canonical staging reads `EXECUTION_CONTROL_STAGING_ENV_FILE`, defaulting to
`/srv/docker/campus-agent/staging/env/runtime.env`.

Required external inputs include:

- execution-control machine ingress URL, Cloudflare Access service-token id and
  secret
- staging app-api smoke auth secret
- shared, document-registry and raw-asset registry Postgres URLs plus operator
  URLs
- staging S3-compatible object-store endpoint, bucket, region and credentials
- staging embedding endpoint and key
- Cloudflare Access team domain and policy audience

The lifecycle projects internal runtime values for execution-control,
agent-runtime, Temporal, Hindsight, Qdrant, metrics and audit. Do not hand-write
internal bridge URLs, Temporal passwords, generated Qdrant keys, Hindsight
secrets or runtime release identity in canonical staging env.

Retired `EXECUTION_CONTROL_DURABLE_WORKER_LOOP_*` and
`EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_*` env keys are invalid in active
staging runtime.

## Ingress

Cloudflare must expose only the machine ingress hostname:

```text
execution-control-staging.mucwiki-edge.link
```

Required posture:

- DNS record is proxied to the staging VM
- Cloudflare Access application is bound to the hostname
- Access policy allows only service-token callers
- VM origin proxy listens on `443` and reverse-proxies only to
  `127.0.0.1:27051`
- container ports are not directly exposed to the public internet

Unauthenticated requests must be rejected by Cloudflare Access. Authenticated
requests must include both Access service-token headers and
`x-worker-origin-auth`.

## Start And Status

Common commands:

```bash
infra/local/staging/start-execution-control-staging.sh
infra/local/staging/start-execution-control-staging.sh --with-ui
infra/local/staging/start-execution-control-staging.sh --with-langfuse
infra/local/staging/stop-execution-control-langfuse.sh
infra/local/staging/status-execution-control-staging.sh --check
```

Canonical runtime shape:

- compose project: `campus-execution-control-staging`
- host port: `27051`
- runtime dir: `.tmp/execution-control-staging`
- compose file: `infra/local/docker-compose.execution-control-runtime.yml`

Default runtime includes execution-control, workflow worker,
activity-worker-core, agent-runtime, activity-worker-agent,
activity-worker-knowledge, Temporal, projection store and data-plane
dependencies. Temporal UI, Langfuse stack, task-queue sampler and
worker-autoscaler are opt-in proof or diagnosis components, not default serving
loop requirements.

Before `docker compose up`, the lifecycle runs preflight and installs/checks the
run projection schema. Schema evidence is written under:

```text
.tmp/execution-control-staging/evidence/
```

## Strict Health

Run:

```bash
infra/local/staging/status-execution-control-staging.sh --check
```

Strict check must prove:

- expected compose services are running
- local `/healthz`, `/readyz` and `/metrics` are reachable with required auth
- `/readyz` reports healthy run projection store and Temporal runtime
- RAG lookup/synthesis and prompt config gates are healthy
- unauthenticated machine ingress is rejected by Cloudflare Access
- authenticated machine ingress reaches execution-control `/readyz`
- `api-staging` reports `auth`, `database`, `executionControl` and
  `executionRuntime` ready

This proves runtime readiness, not autoscaler proof. Worker autoscaler and task
queue sampler evidence live in `temporal-self-host-operations.md`.

## Recovery

Canonical cold start:

```bash
cd /srv/apps/campus-agent
infra/local/staging/stop-execution-control-staging.sh
infra/local/staging/start-execution-control-staging.sh
until infra/local/staging/status-execution-control-staging.sh --check; do
  sleep 2
done
```

If an old dev-backed runtime is running, stop it before starting canonical
runtime. Do not restore the removed Python public ingress fallback.

Logs live under `.tmp/execution-control-staging/logs/`. The main files are:

- `execution-control.log`
- `workflow-worker.log`
- `activity-worker-core.log`
- `agent-runtime.log`
- `activity-worker-agent.log`
- `activity-worker-knowledge.log`
- `otel-collector.log`
- `otel-collector.recent.log`

Log rotation is owned by the staging lifecycle. Ops proof output belongs in the
current evidence directory, not in long-lived service logs.

## Triage

If compose services are not running, inspect the service logs and run:

```bash
infra/local/staging/preflight-execution-control-staging.sh
COMPOSE_PROJECT_NAME=campus-execution-control-staging \
EXECUTION_CONTROL_HOST_PORT=27051 \
docker compose -f infra/local/docker-compose.execution-control-runtime.yml ps
```

If local `/readyz` is degraded, load the staging env and run:

```bash
source infra/local/staging/execution-control-staging-common.sh
execution_control_staging_load_env >/dev/null
execution_control_staging_uv_run --all-packages \
  python -m scripts.doctor_env execution-control --json
curl -sS -H "x-worker-origin-auth: ${API_WORKER_SHARED_SECRET}" \
  http://127.0.0.1:27051/readyz
```

If machine ingress fails, check Cloudflare DNS, Access application, service-token
policy and origin proxy before changing runtime code.

If app-api readiness fails while local execution-control is healthy, check
`https://api-staging.mucwiki-edge.link/readyz` and verify app-api Worker secrets
for execution-control Access service-token credentials and shared secret.

## RAG Release Manifest Recovery

Use manifest recovery only when Qdrant is healthy, the serving alias points at
the intended physical collection, a native snapshot exists, and readiness is
blocked only because the derived object store lacks the matching
`index-release.json`.

Recovery must be an admitted ingestion-control task. Do not bypass a failed
ingestion release with ad hoc object edits.
