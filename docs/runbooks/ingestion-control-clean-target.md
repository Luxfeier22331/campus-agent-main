---
doc_type: runbook
truth_scope: ops
owner_boundary: apps/ingestion-control
status: active
created: 2026-06-12
updated: 2026-06-29
---

# Ingestion Control Clean-Target Runbook

## Scope

This is the active ingestion/data-plane operational entrypoint after retiring
legacy Python collection CLIs.

Legacy Python collection module commands, on-demand batch wrappers, registry
release CLIs, root ingestion runtime smoke/report scripts, Qdrant backup/GC
CLIs and serving seed CLIs are not active operation surfaces.

## Active Runtime Boundary

- `apps/ingestion-control` owns task admission, idempotency, claim / lease,
  retry, dead-letter, terminal closeout and operator-safe projection snapshots.
- `configs/ingestion/<corpus>/<collection>/task-registry.v1.json` declares
  executable task entries with `ts_control` or `rust_kernel` executors only.
- `packages/ingestion-kernels-rs` owns deterministic file kernels.
- `apps/ingestion-worker` is a Python adapter island for extraction work that
  genuinely needs Python, currently legacy Office normalization.
- Eval-owned Python verification must not live under `packages/evals`; it is not
  an ingestion fallback or collection operation surface.

## Local Control Plane

```bash
export INGESTION_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
export INGESTION_TASK_REGISTRY_ROOT=configs/ingestion
pnpm --filter ingestion-control start
```

Health:

```bash
curl -fsS http://127.0.0.1:8000/readyz
```

## Registry Validation

```bash
pnpm --filter ingestion-contracts test
pnpm --filter ingestion-control test -- task-registry.test.ts
uv run --all-packages python -m scripts.check_ingestion_task_executability
```

The registry contract rejects Python adapter executors. If a task requires
Python extraction, model that as a TS-controlled task that invokes a private
adapter process behind an explicit task handler. Do not add a registry fallback
executor.

`scripts.check_ingestion_task_executability` is the current static gate for
registry executability. It classifies every registry-declared task as one of:

- `executable`: default ingestion-control runtime has a real handler / kernel
  bridge for the task.
- `invalid_registry`: the registry declares a task without a real default
  handler / kernel bridge.

Task registries must only contain tasks that are executable in the default
runtime. Do not keep placeholder task declarations in branch tip; when a new
lifecycle step is genuinely needed, redesign the handler/kernel and add the
registry entry in the same change. Do not rely on the presence of
`task-registry.v1.json` alone as execution evidence.

Task admission is registry-aware before storage. `POST
/internal/ingestion/tasks` must reject undeclared collection/task pairs and
output-contract mismatches with HTTP 400 before inserting task rows. A missing
`INGESTION_TASK_REGISTRY_ROOT` is a startup configuration error, not a runtime
fallback to shape-only task validation.

Authenticated internal notice materialization uses
`authenticated_notice_capture_release.v1` as the `source_truth_materialize`
input contract. Admit the task with an `input_ref.kind=object_store` `s3://...`
URI pointing at `capture-release.json`; do not admit collector-run tokens,
Postgres ledger rows or local bundle paths as the mainline task input.

`campus_notices/internal_notice` now has a real TS
`source_truth_materialize` handler in `apps/ingestion-control`. The handler
reads `capture-release.json`, verifies same-bucket bundle / export-manifest
refs, validates byte size / SHA-256 when supplied, and writes
`source-truth/notice-manifest.json`, `content-blocks.jsonl` and
`attachment-refs.jsonl` back to the source bucket.
If this handler is not configured with source-bucket object-store access,
`source_truth_materialize` must fail closed; do not let the generic closeout
path mark authenticated notice source-truth materialization as completed.

`official_web/stable_reference` and `official_web/fresh_news` also have real TS
`source_truth_materialize` handlers. Official-web collectors already write
page-level source-truth artifacts and the run-level `source-truth-bundle.json`;
the ingestion-control handler therefore verifies the terminal handoff object,
the source-truth bundle digest / size and the referenced page source-truth
objects, then closes out with object-store artifact refs. It does not crawl,
parse HTML, rebuild page source-truth or mutate app-api projection state.
If the official-web object store is not configured, these
`source_truth_materialize` tasks must fail closed rather than falling back to
generic closeout.

The default TS handler registry only registers collection-specific real
handlers. A registry-declared `ts_control` task without a registered handler
must fail closed with `ts_handler_not_registered`; it must not complete through
a generic contract skeleton. `canonical_document_materialize`,
`structured_projection_publish`, `operator_projection_snapshot` and
`alias_publish` must not be reintroduced into task registries until they have
explicit collection-specific handlers.

The current default executable TS tasks are:

- `authenticated_notice/campus_notices/internal_notice/source_truth_materialize`
- `official_web/official_web/fresh_news/source_truth_materialize`
- `official_web/official_web/stable_reference/source_truth_materialize`

The current Rust kernel ids in task registries
(`validate-document-units`, `chunk-document-units`,
`validate-release-manifest`) are executable through the ingestion-control Rust
kernel bridge when source-bucket access and `ingestion-kernel-runner` are
configured. The bridge reads the task `input_ref` object, invokes the Rust
binary, verifies stdout JSON `schema_version` against the task
`output_contract`, writes the kernel report/chunk artifact back to the source
bucket and returns an object-store closeout ref. It must fail closed on missing
object-store access, missing binary, non-zero runner exit, unsupported kernel id
or invalid stdout schema; do not add inline JS or Python stand-ins.

Source-bucket task handlers use SDK-backed S3-compatible object-store access
configured by:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_SOURCE_ACCESS_KEY`
- `OBJECT_STORE_SOURCE_SECRET_KEY`
- `OBJECT_STORE_BUCKET_SOURCE` (optional, defaults to `campus-rag-source`)

Rust kernel execution additionally uses:

- `INGESTION_KERNEL_RUNNER_PATH` (optional, defaults to
  `ingestion-kernel-runner` on `PATH`)

Partial object-store configuration must fail closed. Without source-bucket
object-store access, default Rust kernels remain unregistered and registry
tasks fail with `rust_kernel_not_registered` rather than being marked complete.
TS-owned collectors and collector-core packages must not carry Python
`pyproject.toml` workspace shells; they are Node / Crawlee surfaces, not Python
workspace packages.

## Collector Runtime Boundary

Crawlee is the collector execution library for TS-owned web collection
surfaces. It owns crawler-local scheduling, request retry, concurrency, queue
identity, browser navigation and failed-request callbacks inside collector
runners. Official-web sitemap expansion is also delegated to Crawlee
`RobotsTxtFile.parseUrlsFromSitemaps()` and `Sitemap.load()`; the collector only
applies domain admission and failure projection after Crawlee returns URLs.

The repo still owns the domain boundary around those runners:

- source-truth schema, capture-release manifests, object keys and release
  artifacts
- authenticated bootstrap windows, cookies, allowlists and provider adapters
- fail-closed policy, failure record shape and operator-safe projections
- ingestion-control task admission, claim / lease, retry, dead-letter and
  closeout
- object-store uploads, SDK client configuration and source-bucket references
- Python extraction adapter islands that are explicitly modeled behind
  TS-controlled tasks

Collector code should not wrap Crawlee in a repo-wide crawler framework. Keep
only app-local helpers for repeated ephemeral Crawlee configuration, and keep
Crawlee request `userData` internal to the collector runtime.

## Collector Maintenance Rules

- Prefer Crawlee for crawl mechanics before adding custom retry loops, queues,
  browser lifecycle code or request scheduling.
- Prefer SDK-native retry for infrastructure clients such as S3 before adding
  custom backoff code.
- Do not move object-store writes, source-truth parsing, provider/OCR/model
  polling, or ingestion-control task lifecycle into Crawlee.
- Do not reintroduce Python crawler runtime or expand `apps/ingestion-worker`
  beyond explicit extraction adapters.
- Preserve fail-closed behavior for auth, object-store configuration, invalid
  contracts and crawler failures; do not add fallback paths that hide missing
  config or failed collection.
- Update collector README/runbook text only where behavior or operating
  boundaries changed; do not create parallel docs for the same domain.

Verification for collector runtime changes:

```bash
pnpm --filter authenticated-notice-collector test
pnpm --filter authenticated-notice-collector typecheck
pnpm --filter official-web-collector test
pnpm --filter official-web-collector typecheck
pnpm --filter wechat-official-account-collector test
pnpm --filter wechat-official-account-collector typecheck
pnpm repo:static
pnpm web:typecheck
```

## Task Closeout

Task terminal state is recorded through ingestion-control:

- `completed`
- `failed`
- `dead_lettered`

Operator views must consume redacted task projections from ingestion-control.
They must not call object store, Qdrant, registry release logic or Python
adapters directly.

`apps/app-api` may expose authenticated collector-machine ingress and
operator-safe query/projection routes for existing product surfaces, but it must
not import collector app source, shell out to collector package scripts, or own
collection execution. Static boundary tests under `tests/api` guard this
app-api / collector execution split.

## Historical Instructions

Historical Python worker runbook bodies have left branch tip. They are not
current operating instructions; recover specific old fragments through git
history only when they need to be promoted into current docs.
