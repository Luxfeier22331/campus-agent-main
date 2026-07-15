# source-collector

Temporal Activity Worker for source-channel capture.

## Ownership

The runtime currently dispatches four registry tasks:

- `official_web.capture`
- `internal_portal.notice.capture`
- `internal_portal.file_release.capture`
- `wechat_official_account.capture`

Each activity reads a digest-pinned request from object storage, captures the
source through the owning adapter, writes source artifacts and one result
manifest, and returns `ingestion_task_result.v1`. Crawlee and Playwright stay
inside this app boundary; their queues, browser state, storage handles, and
provider credentials never enter ingestion contracts.

Every stored ref carries digest and byte size. Writes use create-or-verify:
new keys are created conditionally, while an existing key is accepted only
when its stored digest and size match the requested bytes. Run-specific fetch
metadata, raw responses and result manifests live below
`runs/<run-id>/attempts/<activity-attempt>/`; content-addressed source-truth
paths must serialize to the same bytes across retries.

The collector does not expose an HTTP control plane, call app-api, maintain a
PostgreSQL run ledger, start workflows, or close task projections. Temporal
owns retry, timeout, heartbeat, and cancellation delivery. The activity reports
bounded progress through heartbeats and stores detailed artifacts in the
source bucket rather than sending progress signals.

Cancellation is propagated to provider fetches, Crawlee runners, portal API
contexts, and object-store writes. A canceled activity cannot write its
terminal result manifest.

## Runtime

```bash
pnpm --filter source-collector start:temporal-worker
```

The production image copies `configs/ingestion` and `configs/sources`, defaults
to the Temporal worker command, and is deployed through
`infra/k8s/ingestion-runtime/base` as a versioned `WorkerDeployment`.
It installs only the Playwright Chromium headless shell required by worker
activities. Firefox, WebKit, branded Chrome, package managers, and development
dependencies are not part of the runtime image. Interactive auth acquisition
remains a trusted local operator command rather than a container entrypoint.

Required shared runtime inputs are the ingestion Temporal address and source
object-store credentials. Provider-specific credentials are injected only into
the source-collector worker.

```bash
docker build --target runtime -f apps/source-collector/Dockerfile -t source-collector .
```

## Verification

```bash
pnpm ci:ingest
```
