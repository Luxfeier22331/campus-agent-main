---
doc_type: runbook
truth_scope: ops
owner_boundary: apps/ingestion-control
status: active
created: 2026-06-12
updated: 2026-07-05
---

# Ingestion Control Clean-Target Runbook

## Document Boundary

This is the active ingestion/data-plane operational entrypoint.

Python collection module commands, on-demand batch wrappers, registry release
CLIs, root ingestion runtime smoke/report scripts, Qdrant backup/GC CLIs and
serving seed CLIs are not active operation surfaces.

## Active Runtime Boundary

- `apps/ingestion-control` owns task admission, idempotency, Temporal workflow
  start, terminal closeout and operator-safe projection snapshots.
- `configs/ingestion/<corpus>/<collection>/task-registry.v2.json` declares
  active task entries only when the default runtime has a real handler / kernel
  bridge. The active registry contract currently recognizes only `ts_control`
  and `rust_kernel`.
- `packages/ingestion-kernels-rs` owns deterministic file kernels.
- `apps/ingestion-worker` is removed from the active workspace. Python code can
  only remain as pure contracts, deterministic helpers / normalizers, or private
  extraction service dependencies invoked by explicit TS handlers. It must not
  construct provider HTTP clients from environment or own lifecycle execution.
- Eval-owned Python verification must not live under `packages/evals`; it is not
  an ingestion fallback or collection operation surface.

## Deployment Shape

`apps/ingestion-control` is a self-hosted internal task control-plane package,
not a Cloudflare Worker.

- `ingestion-control-api`: internal HTTP service for task admission, readiness,
  metrics and operator-safe projections.
- `ingestion-control-temporal-worker`: Temporal workflow / activity worker
  process for run-level orchestration, registry-aware handler or kernel
  execution, and terminal closeout.
- collector jobs or services: source-channel adapters that write source-bucket
  artifacts, run ledgers and source-channel task input refs, then admit
  ingestion tasks through the control plane.
- Python library or private service: extraction function invoked only behind
  explicit TS-controlled handlers.

The API and Temporal worker roles may share the same package or container
image, but they must be deployed as different runtime processes. Collector
processes and `apps/app-api` must not own workflow / activity / closeout truth.

## Local Control Plane

```bash
export INGESTION_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
export INGESTION_TASK_REGISTRY_ROOT=configs/ingestion
export INGESTION_TEMPORAL_ADDRESS=127.0.0.1:7233
export INGESTION_CONTROL_OFFICIAL_WEB_COLLECTOR_TOKEN=local-official-web-token
pnpm --filter ingestion-control start:api
```

Health:

```bash
curl -fsS http://127.0.0.1:8000/readyz
```

The local command starts only the HTTP control-plane surface.

## Local Temporal Worker

```bash
export INGESTION_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
export INGESTION_TASK_REGISTRY_ROOT=configs/ingestion
export INGESTION_TEMPORAL_ADDRESS=127.0.0.1:7233
pnpm --filter ingestion-control start:temporal-worker
```

The Temporal worker command runs workflow / activity execution / closeout in a
separate process. It must not be embedded in `apps/app-api` or collector
processes.
The shared container image uses
`node --experimental-strip-types apps/ingestion-control/src/temporal-worker.ts`
as the worker process command.

## Registry Validation

```bash
pnpm --filter ingestion-contracts test
pnpm --filter ingestion-control test -- task-registry.test.ts
pnpm repo:static
```

The registry contract rejects Python adapter executors. If a task requires
Python extraction, model that as a TS-controlled handler that invokes a private
adapter process behind an explicit handler. Do not add a registry fallback
executor.

`pnpm repo:static` is the current static gate for
registry executability. It reads the default executable inventory from
`packages/ingest-core/src/default-executor-inventory.v1.json`; the static
checker must not maintain a second TS handler / Rust kernel allowlist. It
classifies every registry-declared task and its declared input/output contract
as one of:

- `executable`: default ingestion-control runtime has a real handler / kernel
  bridge for the task and the registry input/output contracts match the default
  executable inventory.
- `invalid_registry`: the registry declares a task without a real default
  handler / kernel bridge, or it points a real handler / kernel at the wrong
  input/output contract.

Task registries must only contain tasks that are executable in the default
runtime. Do not keep placeholder task declarations in branch tip; when a new
lifecycle step is genuinely needed, redesign the handler/kernel and add the
registry entry in the same change. Do not rely on the presence of
`task-registry.v2.json` alone as execution evidence.

The shared task contract names the lifecycle steps that the active runtime can
execute:

- `source_truth_materialize`: TS control handler.
- `document_units_validate`, `chunk_prepare` and
  `release_manifest_validate`: Rust kernel bridge.

Only the first-class name is shared here. Active registries may declare one of
these task kinds only when the corresponding default handler or kernel bridge
is registered and the executability audit returns `executable`.
Collection runtime / chunk profile payload validation belongs to TS
`packages/ingest-core`; Python `chunking*`, `process*`,
`regulation_chunking*`, tokenizer cache and corpus profile modules must not be
introduced as alternate execution paths.

Generic ingestion artifact/model helpers also belong to TS `packages/ingest-core`
or explicit handlers. Do not restore Python `artifact_keys.py`, `artifacts.py`,
`models.py`, `document_import_models.py`,
`campus_agent_ingestion_artifacts.py`, generic `split_manifest.py` or
`raw_ingestion_split_manifest*.py`. A narrow adapter helper such as
`handbook_cleanup_manifest.py` is allowed only for logical document-boundary
validation. It must not grow into canonical markdown generation,
document-units generation or collection split-manifest runtime.

Capture and provider extraction task entries have been removed from the active
task contract. Crawlee collection and provider extraction remain source-channel
/ adapter concerns outside branch-tip task registries until a concrete Temporal
handler contract is redesigned and implemented in the same change.

Task admission is registry-aware before storage. `POST
/internal/ingestion/tasks` must reject undeclared collection/task pairs and
output-contract mismatches with HTTP 400 before inserting task rows. A missing
`INGESTION_TASK_REGISTRY_ROOT` is a startup configuration error, not a runtime
fallback to shape-only task validation.

Official-web collector lifecycle writes also enter this service, not `app-api`:

- `POST /internal/ingestion/official-web/runs`
- `POST /internal/ingestion/official-web/plans:resolve`
- `POST /internal/ingestion/official-web/runs/:runId/heartbeats`
- `POST /internal/ingestion/official-web/runs/:runId/finalize`

These endpoints require `Authorization: Bearer
<INGESTION_CONTROL_OFFICIAL_WEB_COLLECTOR_TOKEN>`. Missing service wiring or
missing/invalid credentials must fail closed. Do not add an app-api proxy or
compatibility route for the removed `/api/official-web/*` collector POST
surface.

Authenticated internal notice materialization uses
`authenticated_notice_capture_release.v1` as the `source_truth_materialize`
input contract. Admit the task with an `input_ref.kind=object_store` `s3://...`
URI pointing at `capture-release.json`; do not admit collector-run tokens,
Postgres ledger rows or local bundle paths as the mainline task input.
The registry-aware executor rejects non-`object_store` input refs before handler
dispatch, so this is enforced at runtime rather than left as documentation only.

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
the ingestion-control handler therefore reads the admitted
`official_web_source_truth_bundle.v1` object-store `input_ref`, verifies the
source-truth bundle digest and the referenced page source-truth objects, then
closes out with object-store artifact refs. It does not crawl, parse HTML,
rebuild page source-truth or mutate app-api projection state.
If the official-web object store is not configured, these
`source_truth_materialize` tasks must fail closed rather than falling back to
generic closeout.

WeChat public-notice collection uses
`wechat_official_account_capture_release.v1` as the `source_truth_materialize`
input contract. The WeChat collector writes article-level source-truth
artifacts during capture; after an app-api run id exists, it writes run-level
`capture-release.json` under
`wechat_official_account/{account_slug}/runs/{run_id}/capture-release.json`.
The collector does not admit ingestion-control tasks. The app-api/control-plane
owner admits `wechat_public_notice/campus_notices/wechat_public_notice/
source_truth_materialize` only after the source-channel run has a finalized
projection and capture-release object-store ref. The ingestion-control handler
verifies the release run id, same-bucket article source-truth refs and SHA-256
values, then closes out with object-store refs. It does not call FeedWe, crawl
WeChat, parse article HTML, or mutate app-api run ledger rows.

The default TS handler registry only registers collection-specific real
handlers. A registry-declared `ts_control` task without a registered handler
must fail closed with `ts_handler_not_registered`; it must not complete through
a generic contract skeleton. `canonical_document_materialize`,
`structured_projection_publish`, `operator_projection_snapshot` and
`alias_publish`, `document_projection_materialize`, `read_model_materialize`
and `derived_scope_materialize` must not be reintroduced into task registries
as placeholders. Newly designed downstream materialization must arrive in the
same change that wires an explicit collection-specific handler and contract.

The current default executable TS task inventory lives in
`packages/ingest-core/src/default-executor-inventory.v1.json`. Add a task to
that inventory only in the same change that wires the real default handler,
records the exact input/output contract pair and updates registry executability
tests.

Post-source-truth materialization must not keep generic report-only handlers or
registry entries that merely echo the input object into a materialization
report.

Do not add active capture or provider-extract task entries until the
corresponding Temporal handler contract is redesigned, implemented and covered
by the executability gate.

The current Rust kernel id inventory also lives in
`packages/ingest-core/src/default-executor-inventory.v1.json`. These ids are
executable through the ingestion-control Rust kernel bridge only with the
inventory-declared input/output contract pair, and only when source-bucket
access and `ingestion-kernel-runner` are configured. The bridge reads the task
`input_ref` object, invokes the Rust binary, verifies stdout JSON
`schema_version` against the task `output_contract`, then parses the stdout
through the `packages/ingest-core` Zod-backed parser for that contract. The
bridge writes the validated kernel artifact back to the source bucket and
returns an object-store closeout ref. It must fail closed on missing
object-store access, missing binary, non-zero runner exit, unsupported kernel
id, contract mismatch, unknown output contract, invalid stdout JSON or invalid
stdout contract shape; do not add inline JS or Python stand-ins.

Source-bucket task handlers use SDK-backed S3-compatible object-store access
configured by:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_SOURCE_ACCESS_KEY`
- `OBJECT_STORE_SOURCE_SECRET_KEY`
- `OBJECT_STORE_BUCKET_SOURCE` (optional, defaults to `campus-agent-source`)

`ingestion-control` official-web projection is stricter: terminal runs may
admit ingestion-control tasks only when the projection projector has an explicit
source bucket. The projector must fail closed rather than constructing task
`input_ref` values from an implicit bucket default.

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
identity, `uniqueKey` de-duplication, browser navigation and failed-request
callbacks inside collector runners. Official-web sitemap expansion is also
delegated to Crawlee
`RobotsTxtFile.parseUrlsFromSitemaps()` and `Sitemap.load()`; the collector only
applies domain admission and failure projection after Crawlee returns URLs.

The repo still owns the domain boundary around those runners:

- source-truth schema, capture-release manifests, object keys and release
  artifacts
- authenticated bootstrap windows, cookies, allowlists and provider adapters
- fail-closed policy, failure record shape and operator-safe projections
- ingestion-control task admission, Temporal workflow start, registry-aware
  activity dispatch and closeout
- object-store uploads, SDK client configuration and source-bucket references
- Python extraction adapter islands that are explicitly modeled behind
  TS-controlled tasks

Collector code should not wrap Crawlee in a repo-wide crawler framework. Keep
only app-local helpers for repeated ephemeral Crawlee configuration, and keep
Crawlee request `userData` internal to the collector runtime. Crawlee storage
and request identity must not replace source-bucket `capture-release.json` /
bundle object refs as the ingestion-control handoff.

## Collector Maintenance Rules

- Prefer Crawlee for crawl mechanics before adding custom retry loops, queues,
  browser lifecycle code or request scheduling.
- Prefer SDK-native retry for infrastructure clients such as S3 before adding
  custom backoff code.
- Do not move object-store writes, source-truth parsing, provider/OCR/model
  polling, or ingestion-control task lifecycle into Crawlee.
- Do not construct OCR / multimodal provider HTTP clients inside a default
  Python ingestion package; provider execution must enter through an explicit
  TS-controlled handler or injected private adapter boundary.
- Do not restore handbook / curriculum provider-response normalization or
  source-truth validation as Python default modules. If provider extraction is
  needed again, expose it through an admitted adapter contract that returns
  canonical artifacts or document units.
- Do not restore Python semantic chunking, runtime profile parsing, tokenizer
  cache, process/indexable chunk generation, curriculum document-units
  generation, handbook cleanup materialization or regulation chunking modules.
  Default document-units validation and chunk preparation must stay in the Rust
  kernel bridge with TS contract/profile parsing; do not restore
  `curriculum_chunk_units*`, `curriculum_document_units*` or Python
  `handbook_cleanup*` materialization modules.
- Do not reintroduce Python crawler runtime or `apps/ingestion-worker`.
- Do not reintroduce source-truth replay CLIs, local attachment `blob_root`
  backfills, provider comparison CLIs, runtime smoke CLIs, or document canonical
  markdown backfills as active ingestion operation surfaces.
- Preserve fail-closed behavior for auth, object-store configuration, invalid
  contracts and crawler failures; do not add fallback paths that hide missing
  config or failed collection.
- Update collector README/runbook text only where behavior or operating
  boundaries changed; do not create parallel docs for the same domain.

Verification for collector runtime changes:

```bash
pnpm --filter source-collector test
pnpm --filter source-collector typecheck
pnpm repo:static
pnpm web:typecheck
```

## Task Closeout

Task terminal state is recorded through ingestion-control:

- `completed`
- `failed`
- `canceled`

Operator views must consume redacted task projections from ingestion-control.
They must not call object store, Qdrant, registry release logic or Python
adapters directly.

`apps/app-api` may expose authenticated collector-machine ingress and
operator-safe query/projection routes for existing product surfaces, but it must
not import collector app source, shell out to collector package scripts, or own
collection execution. `pnpm repo:static` enforces this app-api / collector
execution split through repo-owned static checks.

## Historical Instructions

Historical Python worker runbook bodies have left branch tip. They are not
current operating instructions; recover specific old fragments through git
history only when they need to be promoted into current docs.
