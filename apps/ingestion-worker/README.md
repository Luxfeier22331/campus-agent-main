# campus-ingestion-worker

Runtime shell for campus-agent v2 ingestion commands.

Env bootstrap rule:

- Worker CLI first reads `./.env` from the current repo/worktree root.
- Worker CLI does not fall back to another worktree's `.env`; missing local env
  should be fixed explicitly in the current worktree.
- Do not introduce local mock backends or file-registry compatibility paths just
  because a feature worktree is missing `.env`.
- current worktree `.env` owns the runtime config consumed by local worker
  commands.
- Current operator override examples live under `env/commands/*.env.example`.
- Retained historical recovery examples live under
  `env/commands/historical/*.env.example`.

## Commands

`apps/ingestion-worker` exposes ingestion runtime shells.

- New target-runtime work starts at the ingestion task executor seam:
  `campus_ingestion_worker.ingestion_task_executor` claims a validated task from
  ingestion-control, dispatches an adapter, and reports completed / failed
  closeout. Existing Python collection CLIs are deletion-first legacy surfaces,
  not assets to migrate wholesale; see
  `docs/reference/ingestion-python-cli-clean-target-triage.md`.
- Default low-frequency operation is on-demand batch execution: pull up a
  bounded CLI job, emit a JSON report, then exit. Do not keep a full Python
  ingestion worker resident for the current notice volume. See
  `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md`.
- Query-serving scope is controlled by
  `configs/ingestion/<corpus>/<collection>/runtime-profile.json`, not by worker
  defaults.
- Data-plane ingestion currently covers `regulations/student_rules` and
  `curriculum/curriculum_plan`.
- Current runtime truth lives in
  `configs/ingestion/<corpus>/<collection>/runtime-profile.json`.
- Phase 03.2 freezes `single source consumption + multi-projection fan-out` as
  the canonical ingestion model: a source asset is consumed once, source truth
  is persisted once, and downstream outputs rebuild from declared projections
  instead of returning to the original PDF.
- Serving/indexing terms follow
  `docs/reference/runtime-serving-and-index-terms.md`.
- Operator release flow follows `docs/runbooks/index-release-runbook.md`.

### `campus_ingestion_worker.on_demand_batch_runner`

Lightweight orchestration shell for bounded ingestion batches.

Supported batch kinds:

- `authenticated-notice-closeout`
- `official-web-handoffs`
- `internal-notice-multimodal-drain`

Behavior:

- Loads current worktree `.env`
- Runs existing ingestion worker modules in child processes
- Stops at the first failed step
- Emits a JSON report with per-step exit code, elapsed time, peak RSS, stdout
  JSON when available, and stderr tail
- Exits non-zero when any step fails

Example:

```bash
uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  internal-notice-multimodal-drain \
  --limit 100 \
  --batch-size 20 \
  --consumer-admission-manifest-path \
  /etc/campus-agent/internal-notice-consumer-admission-manifest.json \
  --report-path .tmp/ingestion-reports/internal-notice-multimodal.json
```

### `campus_ingestion_worker.deployment_preflight`

Deployment preflight for the ingestion worker shell.

Default behavior:

- Loads current worktree `.env`
- Checks Python runtime, report directory, lock directory, shared/operator
  Postgres URL shape, and object-store config
- Checks batch-specific local directories such as `official_web` handoff inbox
  paths when that batch kind is selected
- Skips live network probes unless `--live` is passed
- Prints a JSON report and exits non-zero on failed checks

Example:

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.deployment_preflight \
  --batch-kind internal-notice-multimodal-drain \
  --report-dir .tmp/ingestion-reports \
  --lock-dir .tmp/ingestion-locks
```

Server deploy preflight should add `--live` after env and network access are
configured.

### `campus_ingestion_worker.report_retention`

Retention shell for on-demand batch reports.

Example:

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.report_retention \
  --report-dir .tmp/ingestion-reports \
  --max-age-days 14 \
  --max-count 200 \
  --keep-failed
```

### Authenticated Notice Source Attachment Cleanup

`campus_ingestion_worker.audit_authenticated_notice_source_attachment_keys` audits
`campus-rag-source` authenticated-notice attachment objects against canonical
`source-truth/attachment-refs.jsonl`.

`campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys`
can delete only explicit candidate inventories. Destructive cleanup requires
`--yes`; dry-run should be run first.

Runbook:

- `docs/runbooks/authenticated-notice-source-bucket-attachment-cleanup-runbook.md`

### Object Store Hygiene And Serving Seed

`campus_ingestion_worker.audit_source_bucket_hygiene` and
`campus_ingestion_worker.audit_derived_bucket_hygiene` audit source / derived
bucket root prefixes against the accepted object-key contract. They are
read-only.

`campus_ingestion_worker.cleanup_derived_bucket_unexpected_keys` deletes only exact
`unexpected-keys.jsonl` rows emitted by the derived bucket audit. The inventory
must include bucket, root prefix, reason and object key; destructive execution
requires `--yes`.

`campus_ingestion_worker.audit_authenticated_notice_source_run_retention`
classifies `authenticated_notice_portal/runs/` evidence by DB / repo
references.
`campus_ingestion_worker.cleanup_authenticated_notice_source_runs` deletes only
exact delete-candidate source run object inventories and verifies post-delete
absence.

`campus_ingestion_worker.export_serving_seed`,
`campus_ingestion_worker.verify_serving_seed`, and
`campus_ingestion_worker.restore_serving_seed` define the object-store seed
handoff for published document reader assets. The seed package is a manifest
plus S3 object references/checksums; large reader assets remain in object
storage, not Git.

Runbooks:

- `docs/runbooks/document-reader-publish-and-docs-deploy-runbook.md`
- `docs/runbooks/authenticated-notice-source-bucket-attachment-cleanup-runbook.md`
- `docs/runbooks/index-release-runbook.md`

### Unified Operator Shell

Operator scripts now use a unified shell:

- `scripts/run-ingestion-worker-batch.sh`
- wrappers:
  - `scripts/run-internal-notice-multimodal-drain.sh`
  - `scripts/run-official-web-handoffs.sh`
  - `scripts/run-authenticated-notice-closeout.sh`
  - `scripts/run-wechat-public-notices.sh`

The unified shell runs `preflight -> flock lock -> batch runner -> report retention`.

### `campus_ingestion_worker.project_wechat_public_notices`

Projects WeChat source-truth artifacts into
`ingestion_projection.notice_consumption_projection`.

Selection inputs (at least one required):

- `--article-manifest-key ...` (repeatable)
- `--selection-path <path>`
- `--capture-run-id <run_id>`
- `--latest-completed-capture-run --capture-account-slug <slug>`

Notes:

- `--capture-run-id` / `--latest-completed-capture-run` read refs from
  `wechat_official_account.capture_runs` + `run_artifacts`.
- Capture-run selection requires one of:
  `WECHAT_OFFICIAL_ACCOUNT_CAPTURE_LEDGER_DATABASE_URL` /
  `CAMPUS_SHARED_POSTGRES_URL` /
  `NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL` /
  `INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL` /
  `DOCUMENT_REGISTRY_DATABASE_URL`.
- Default mode writes projection rows (`non-dry-run`) and records admission
  events; use `--dry-run` for validation-only execution.

Example:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.project_wechat_public_notices \
  --latest-completed-capture-run \
  --capture-account-slug "中央民族大学学生会" \
  --source-bucket campus-rag-source
```

### `campus_ingestion_worker.official_web_handoff_receiver`

Internal local `official_web` handoff receiver module for
`app-api -> ingestion-worker` seam verification.

Required env:

- `INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_TOKEN`

Optional env:

- `INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_INBOX_DIR`
- `INGESTION_WORKER_HTTP_HOST`
- `INGESTION_WORKER_HTTP_PORT`

Command override example:

- `env/commands/official-web-handoff-receiver.env.example`

Behavior:

- Exposes `POST /api/official-web/handoffs`
- Requires `Authorization: Bearer <token>`
- Validates the typed `official_web` handoff payload before accepting it
- Persists one durable inbox record per `eventId` under the configured inbox
  directory
- Returns a stable `dispatchRef` for duplicate deliveries of the same `eventId`
- Exposes `GET /healthz` and `GET /readyz` for local seam checks
- Seeds new inbox records with `processingStatus=pending` and
  `processingAttemptCount=0`
- This receiver closes the handoff acceptance seam only; offline execution
  happens in a separate consumer shell

### `campus_ingestion_worker.official_web_handoff_consumer`

Offline `official_web` handoff consumer for `app-api -> ingestion-worker` replay
verification.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `DOCUMENT_REGISTRY_DATABASE_URL` or `CAMPUS_SHARED_POSTGRES_URL`
- `RAW_ASSET_REGISTRY_DATABASE_URL` or `DOCUMENT_REGISTRY_DATABASE_URL` or
  `CAMPUS_SHARED_POSTGRES_URL`

Optional env:

- `OBJECT_STORE_BUCKET_SOURCE`
- `OBJECT_STORE_BUCKET_DERIVED`
- `INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_INBOX_DIR`
- `INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_EXECUTION_ROOT_DIR`
- `INGESTION_WORKER_OFFICIAL_WEB_PROMOTE_IMPORT`
- `INGESTION_WORKER_OFFICIAL_WEB_MINIMUM_PROMOTE_PAGES`
- `INGESTION_WORKER_OFFICIAL_WEB_MINIMUM_SEED_COVERAGE_RATIO`
- `INGESTION_WORKER_OFFICIAL_WEB_MINIMUM_HOST_COVERAGE_RATIO`
- `INGESTION_WORKER_APP_API_BASE_URL`
- `INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET`

Optional CLI args:

- `--event-id`
- `--limit`
- `--force`
- `--promote`
- `--admit-release-tasks`
- `--declarations-path`

Command override example:

- `env/commands/official-web-handoff-consumer.env.example`

Behavior:

- Reads durable inbox records written by
  `campus_ingestion_worker.official_web_handoff_receiver`
- Resolves `source_truth_bundle` only from handoff `artifacts`; a missing
  artifact fails closed as `missing_source_truth_bundle`
- Downloads `source-truth-bundle.json` and each page `page-manifest.json` /
  `content-blocks.jsonl` from the source bucket
- Reconstructs a local replay input tree under the configured execution root
- Runs `official_web` projection replay, projection validator, chunk audit, and
  coverage gates, then writes `execution-report.json`
- Default behavior is `stage` only: replay outputs and audit evidence are
  materialized locally, but registry current truth is not mutated
- Only explicit `--promote` /
  `INGESTION_WORKER_OFFICIAL_WEB_PROMOTE_IMPORT=true` allows registry writes,
  and promotion still fails closed on low coverage, failed chunk audit, or
  staged-only page-family output
- Promotion success upserts canonical `RawAssetRecord` and
  `DocumentRegistryRecord` entries for replayed `official_web` documents
- Calls back into `app-api` `POST
  /api/internal/official-web/runs/:runId/ingestion-execution` when the optional
  callback env is configured
- When `--admit-release-tasks` is set, converts ready selected-write candidate
  reviews into ingestion-owned release task rows. Without that flag it only
  reports `releaseTasks.disabledReason=release_task_store_not_configured`.
- Updates each inbox record with `processingStatus`, `processingAttemptCount`,
  `processedAt`, `lastError`, `executionReportPath`, `projectionOutputDir`, and
  `replayInputDir`
- `processingStatus` now distinguishes `staged`, `promoted`, and `failed`

### `campus_ingestion_worker.admit_official_web_release_gate`

Admits an approved `official_web/stable_reference` release gate into the
ingestion-owned release task store.

Required env:

- `OFFICIAL_WEB_RELEASE_TASK_DATABASE_URL` or `CAMPUS_SHARED_POSTGRES_URL`

Required CLI args:

- `--release-gate-path`

Behavior:

- Fails closed unless the gate is approved and targets
  `official_web/stable_reference`
- Creates an idempotent queued `official_web_stable_reference` task
- Does not execute the task and does not call app-api

### `campus_ingestion_worker.run_official_web_release_task`

Claims and executes one queued ingestion-owned `official_web` release task.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `OFFICIAL_WEB_RELEASE_TASK_DATABASE_URL` or `CAMPUS_SHARED_POSTGRES_URL`
- `OFFICIAL_WEB_RELEASE_TASK_OPERATOR_DATABASE_URL` or operator shared DB env
- `INGESTION_WORKER_APP_API_BASE_URL`
- `INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET`

Local dev:

- set explicit `INGESTION_WORKER_APP_API_*` values for the local `app-api`
  callback; `APP_API_INTERNAL_SHARED_SECRET` is not promoted into worker
  callback env

Optional CLI args:

- `--worker-id`
- `--lease-seconds`
- `--work-dir`
- `--task-type`
- `--declarations-path`
- `--reset-index`

Behavior:

- Claims one queued task via the release task state machine
- Dispatches stable-reference tasks to `release_official_web_target`
- Dispatches selected-write tasks to `release_official_web_selected_write`
- Marks materialized / indexed / published / failed state in the task store
- Fails closed unless the app-api operator projection callback env is
  configured
- Reports redacted operator snapshots to app-api as part of the canonical
  release-task execution path

Local integration smoke:

```bash
uv run --all-packages python -m scripts.official_web_release_task_local_smoke \
  --app-api-base-url http://127.0.0.1:27031 \
  --app-api-internal-shared-secret "$INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET"
```

### `campus_ingestion_worker.official_web_projection_import`

Operator-facing local import shell for a validated `official_web` projection
output.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `DOCUMENT_REGISTRY_DATABASE_URL` or `CAMPUS_SHARED_POSTGRES_URL`
- `RAW_ASSET_REGISTRY_DATABASE_URL` or `DOCUMENT_REGISTRY_DATABASE_URL` or
  `CAMPUS_SHARED_POSTGRES_URL`

Required CLI args:

- `--projection-output-dir`
- `--replay-input-dir`
- `--work-dir`
- `--corpus`
- `--collection`

Optional CLI args:

- `--source-bucket`
- `--require-promotable`

Behavior:

- Reads a local replayed `projection-report.json` plus
  `replay-input/source-truth-bundle.json`
- Reconstructs canonical import inputs from local `canonical.md` /
  `document-units.jsonl` and source-bucket provider artifacts
- Supports registry `scope_refresh` so one clean subset can replace the current
  truth of a target scope in one import
- `--require-promotable` fails closed if any replayed document is
  non-`promotable` or belongs to staged-only page families
- Intended for local subset validation and controlled current-truth replacement
  before running `campus_ingestion_worker.release_registry_scope`

### Removed historical official-web backfill

The historical official-web backfill Python worker entrypoint has been removed.
It was a one-off recovery path, not a current official-web release or ingestion
lifecycle owner. If this recovery capability returns, rebuild it as an
explicitly admitted ingestion-control recovery task with object-store inventory
proof instead of restoring the Python CLI.

### `campus_ingestion_worker.audit_collection_runtime_state`

Read-only runtime audit shell for collection rename closeout.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `QDRANT_URL`

Optional env:

- `OBJECT_STORE_BUCKET_DERIVED`
- `QDRANT_API_KEY`

Behavior:

- inventories legacy and canonical release manifest families under the derived
  bucket
- inspects legacy and canonical Qdrant alias / physical collection families
- reports current runtime state for:
  - `regulations/student_handbook -> regulations/student_rules`
  - `regulations/institutional_regulations -> regulations/institutional_rules`
- does not mutate object storage, Qdrant, or registry truth

### `process_raw_ingestion_job`

Worker shell for the production raw-first path.

Phase-2 canonical flow:

1. `register_raw_asset` uploads the handbook source PDF into the source bucket
   and persists canonical raw-layer truth.
1. `process_raw_ingestion_job` consumes the registered `raw_asset_id +
   raw_version_id` instead of any local file path.

### `register_raw_asset`

Worker shell for canonical raw-asset registration.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `RAW_ASSET_REGISTRY_DATABASE_URL` or `DOCUMENT_REGISTRY_DATABASE_URL`

Required CLI args:

- `--file-path`
- `--raw-source-uri`
- `--corpus`
- `--collection`

Optional CLI args:

- `RAW_ASSET_ID`

Behavior:

- Computes `content_hash = sha256(file_bytes)` and `raw_version_id =
  sha256:<content_hash>`.
- Defaults `raw_asset_id` to `build_raw_asset_id(source_filename)` when no
  override is supplied.
- Writes the source PDF into the source bucket under the canonical raw object
  key.
- Upserts raw-layer truth in the raw asset registry before OCR processing
  begins.
- Repeated registration of the same source filename and identical bytes reuses
  the existing raw-asset record.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `OCR_BASE_URL`
- `OCR_API_KEY`
- `RAW_ASSET_REGISTRY_DATABASE_URL` or `DOCUMENT_REGISTRY_DATABASE_URL`

Required CLI args:

- `--raw-asset-id`
- `--raw-version-id`
- `--corpus`
- `--collection`

Optional env:

- `DOCUMENT_REGISTRY_DATABASE_URL`
- `RAW_ASSET_REGISTRY_DATABASE_URL`
- `OCR_MODEL`
- `OCR_PROVIDER_MODE`
- `OCR_POLL_SECONDS`
- `OCR_TIMEOUT_SECONDS`
- `OCR_RESULT_READY_GRACE_SECONDS`
- `OCR_MINERU_BASE_URL`
- `OCR_MINERU_API_KEY`
- `OCR_MINERU_PROVIDER_MODE`
- `OCR_MINERU_MODEL`
- `OCR_MINERU_LANGUAGE`
- `OCR_MINERU_ENABLE_FORMULA`
- `OCR_MINERU_FORCE_OCR`
- `OCR_MINERU_POLL_SECONDS`
- `OCR_MINERU_TIMEOUT_SECONDS`
- `IMPORT_REPORT_DIR`
- `INGESTION_SPLIT_MANIFEST_PATH`
- `RAW_INGESTION_ARTIFACT_MODE`
- `INGESTION_EMBEDDING_MODEL`
- `INGESTION_DEFAULT_VISIBILITY_SCOPE`
- `HF_HOME` / `HF_HUB_CACHE` / `TRANSFORMERS_CACHE`
- `HF_HUB_OFFLINE`

Command override example:

- `env/commands/process-raw-ingestion-job.env.example`

Behavior:

- Reads the source file from the source bucket using canonical raw-asset
  registry metadata.
- Does not accept local PDF paths or placeholder local job envelopes.
- Primary `OCR_*` settings still define the canonical Paddle lane;
  `OCR_PROVIDER_MODE=mineru_api` is intentionally rejected as the primary
  raw-ingestion provider.
- Optional `OCR_MINERU_*` settings enable a second provider only for
  `RAW_INGESTION_ARTIFACT_MODE=source_truth_only` conditional routing. Current
  repo truth is:
  - typed PDF: MinerU primary; Paddle is only an explicit secondary lane when
    the typed routing contract requests it
  - `generic_image`: dual-run Paddle + MinerU, refine raw asset type, then
    choose canonical provider
  - refined `simple_table_image`: Paddle primary
  - refined `complex_table_image`: MinerU primary
  - refined `spatial_image` / `office_document`: deferred fail-close
- Source-bucket objects live under
  `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...` and are
  intentionally not scoped by corpus because one source asset may feed multiple
  corpora.
- Default `RAW_INGESTION_ARTIFACT_MODE=normalized` stores source-level
  `provider-response.jsonl` and `layout-elements.jsonl`, persists canonical
  source truth, then fans out into declared downstream projections that may
  write per-document `canonical.md` and `document-units.jsonl`.
- Normalized and `source_truth_only` modes both keep source-owned artifacts
  under the same canonical source prefix, split by `capture/`, `provider/`, and
  `source-truth/`; when a replay/materialization path emits persisted
  source-side projection outputs, they live under the sibling
  `projection/<projection_name>/...` stage in the same prefix.
- Normalized mode writes derived document artifacts under `{corpus}/documents/{c
  ollection}/{title_slug}--{docid8}/{revision_track}/{year}/`.
- `RAW_INGESTION_ARTIFACT_MODE=source_truth_only` stores asset-level
  `provider-response.jsonl` and `layout-elements.jsonl`, but skips
  `canonical.md` / `document-units.jsonl` and document-registry writes.
- When `source_truth_only` routes a typed PDF through MinerU successfully, the
  worker persists canonicalized `provider-response.jsonl`,
  `layout-elements.jsonl`, and an extra raw provenance sidecar
  `provider-response-raw.zip`.
- When `source_truth_only` dual-runs a `generic_image`, the worker also persists
  `ocr-routing-decision.json` under the source-truth stage and writes the
  refined `asset_subkind` back into raw-asset registry truth.
- `source_truth_only` still writes canonical raw-asset provenance and should use
  the configured canonical raw-asset registry backend.
- Runtime-profile gating decides whether the selected `corpus + collection`
  accepts `normalized` or `source_truth_only`.
- `curriculum/curriculum_plan` may use `source_truth_only` as a pre-split
  onboarding path to inspect real OCR output before freezing its split manifest.
- For `regulations/student_rules` and `curriculum/curriculum_plan`, normalized
  mode requires a split manifest and stores asset-level
  `provider-response.jsonl` / `layout-elements.jsonl` plus per-document
  `document-units.jsonl`; handbook also exports `canonical.md`.
- `regulations/student_rules` normalized mode rebuilds logical documents
  strictly from the repo-tracked split manifest; no legacy OCR-import adapter or
  non-`provider-response.jsonl` handbook input is supported.
- `regulations/student_rules` downstream fan-out is declared in
  `configs/ingestion/regulations/student_rules/source-projections.v1.json`.
- When canonical source truth for the same source asset already exists, later
  collection work, handbook-derived service outputs, and attachment-derived
  outputs must rebuild from source truth through declared projections; do not
  return to the original PDF.
- Attachment-bearing, appendix-bearing, form-like, and navigation-like handbook
  leaves may materialize as explicit derived documents when they have standalone
  downstream value.
- Handbook retrieval preparation stays ingestion-owned: persisted
  `document-units.jsonl` feeds chunk generation in `packages/ingestion-core`,
  and `index_chunks_to_qdrant()` writes the canonical online chunk/index state
  into Qdrant.
- `regulations/student_rules` chunk budgeting uses the `Qwen/Qwen3-Embedding-4B`
  tokenizer from local Hugging Face cache only. Prefetch it explicitly with `uv
  run --all-packages python -m campus_ingestion_core.prefetch_tokenizer`, then
  keep worker/runtime/test runs on `HF_HUB_OFFLINE=1`; the ingestion code no
  longer falls back to implicit network download.
- Only normalized mode registers derived document results in the document
  registry with `import_source=raw_online_ocr`.
- Normalized document-registry writes persist the scope cleaning policy version
  for traceability.
- Current OCR ingestion defaults to `revision_track=source-faithful`,
  `source_channel=pdf_ocr`, `is_current=false`.
- Spatial images, office documents, and other deferred raw-asset classes still
  fail closed even when `OCR_MINERU_*` is configured; dual-run only exists to
  decide whether an ambiguous image should stay Paddle, promote MinerU, or be
  deferred.

### `rebuild_local_data`

Corpus-scoped rebuild shell for MinIO + registry.

Required CLI args:

- `--mode`
- `--corpus`
- `--collection`

Mode-specific CLI args:

- `provider_response_replay` requires `--raw-version-id`
- `provider_response_replay` can additionally accept `--raw-asset-id` and
  `--source-pdf`

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`

Optional env:

- `DOCUMENT_REGISTRY_DATABASE_URL`
- `RAW_ASSET_REGISTRY_DATABASE_URL`
- `INGESTION_SPLIT_MANIFEST_PATH`
- `HANDBOOK_SOURCE_PROJECTIONS_PATH`
- Any env required by the selected import mode

Command override example:

- `env/commands/rebuild-local-data.env.example`

Behavior:

- `raw_online_ocr` deletes only the selected derived scope prefix and the source
  artifacts explicitly selected by registry identity.
- `raw_online_ocr` deletes only the selected scope records from the
  document/raw-asset registry.
- Dispatches to `process_raw_ingestion_job` when `--mode raw_online_ocr`.
- Dispatches to source-truth replay rebuild when `--mode
  provider_response_replay`.
- `provider_response_replay` preserves source-bucket provenance and raw-asset
  registry provenance.
- `provider_response_replay` 只接受 typed request identity 与 repo-tracked
  collection truth，核心输入是 `raw_version_id`。
- `provider_response_replay` reads an existing object-store
  `provider-response.jsonl`, rewrites asset-level `layout-elements.jsonl`,
  rebuilds persisted source truth, and re-emits declared projections such as
  per-document `canonical.md` / `document-units.jsonl` without synthesizing
  raw-layer records.
- handbook replay默认 `--source-pdf 学生手册_2018.pdf`。
- `provider_response_replay` does not index Qdrant by default; add
  `--index-qdrant` when replay should also rebuild chunk/embedding/vector state.
- `--reset-qdrant` and `--index-qdrant` are independent: reset only clears the
  alias family, while replay indexing is opt-in.
- `--publish-alias` / `--no-publish-alias` control whether a successful index
  release should switch the serving alias after validation.
- Rebuild / replay now resolve `qdrant_alias_name` and
  `qdrant_collection_prefix` from each collection runtime profile instead of any
  global collection-name env.
- `provider_response_replay` is the canonical rebuild boundary for downstream
  fan-out; later projection work must not create handbook-only replay branches
  or separate raw re-consumption lanes.

### `release_index`

Operator-facing release shell for one `provider_response_replay -> chunking ->
embedding -> indexing -> optional alias publish` run.

Required CLI args:

- `--corpus`
- `--collection`
- `--raw-version-id`

Optional CLI args:

- `--raw-asset-id`
- `--source-pdf`
- `--reset-index`
- `--publish-alias`
- `--no-publish-alias`

Behavior:

- Always runs a Qdrant index release from persisted source truth.
- Creates a new physical collection as `<collection_prefix>__<release_id>`.
- Writes release manifests under
  `{corpus}/releases/{collection}/{release_id}/...`.
- Only switches the serving alias when `--publish-alias` is enabled.
- Never writes chunk dumps back to object storage.

### `campus_ingestion_worker.release_registry_scope`

Operator-facing release shell for an already-imported registry scope.

Required CLI args:

- `--corpus`
- `--collection`

Optional CLI args:

- `--reset-index`
- `--publish-alias`
- `--no-publish-alias`

Command override example:

- `env/commands/release-registry-scope.env.example`

Behavior:

- Reads current scope truth from `DocumentRegistry`, not from local projection
  output.
- Rebuilds chunks from each record's `document_units_object_key`.
- Uses the scope runtime profile to select releasable records:
  - `status=active`
  - `serving_revision_tracks` when configured
  - `is_current=true` when `current_only=true`
- Creates a new physical collection as `<collection_prefix>__<release_id>`.
- Writes release manifests under
  `{corpus}/releases/{collection}/{release_id}/...`.
- Only switches the serving alias when `--publish-alias` is enabled.
- This is the current operator entry for `official_web/muc_public_pages` after
  handoff replay/import has already populated registry truth.

### `campus_ingestion_worker.materialize_curriculum_program_semester_facts`

Operator-facing shell for rebuilding `curriculum/program_semester_facts` from
canonical `curriculum_plan document-units`.

Required CLI args:

- none

Behavior:

- Loads the worker env and reads canonical `curriculum_plan` document-units from
  the derived bucket
- Materializes `program_semester_facts` canonical document artifacts plus
  registry truth
- Does not publish a Qdrant alias by itself; the follow-up release step remains
  `campus_ingestion_worker.release_registry_scope`
- Exists specifically to avoid routing this recovery path back through
  raw/source bucket replay

### `project_official_web_source_truth`

Local replay shell for the current `official_web` source-truth QC batches.

Required CLI args:

- `--output-dir`
- `--projection-output-dir`

Optional CLI args:

- `--declarations-path`

Behavior:

- Reads local collector output from `source-truth-bundle.json` plus per-page
  `page-manifest.json` / `content-blocks.jsonl`
- Applies repo-tracked
  `configs/sources/official_web/<site_id>/projection-declarations.json`
- Emits local canonical document artifacts:
  - `projection-report.json`
  - `documents/<target_corpus>/<target_collection>/<doc-dir>/canonical.md`
  - `documents/<target_corpus>/<target_collection>/<doc-dir>/document-units.json
    l`
- Keeps shell-family pages in `manual_review`; does not auto-emit them as正文文档
- Does not touch document registry, chunking, index release, or serving alias

### `validate_official_web_projection`

Validator for the local `official_web` projection replay output.

Required CLI args:

- `--projection-output-dir`

Behavior:

- Verifies `projection-report.json` exists and is parseable
- Verifies every emitted document still has both `canonical.md` and
  `document-units.jsonl`
- Verifies `document-units.jsonl` rows keep stable `doc_id` / `version_id`
- Fails closed when emitted document artifacts are missing or empty

### `campus_ingestion_worker.audit_official_web_projection_chunking`

Local audit shell for `official_web` cleaning/chunking quality before import or
release.

Required CLI args:

- `--projection-output-dir`

Behavior:

- Reads `projection-report.json`, `canonical.md`, and `document-units.jsonl`
  from local projection output
- Rebuilds runtime chunks from emitted `document-units.jsonl` without touching
  document registry
- Reports per-document unit/chunk counts, token summary, short-chunk counts, and
  representative warning examples
- Surfaces local warning classes such as collapsed `section_path`, stacked short
  label lines, and ellipsis truncation
- Does not write registry truth, Qdrant collections, or serving aliases

### `qdrant_filesystem_backup_create`

Active operator-facing backup shell for one release-managed Qdrant collection
snapshot on the local filesystem.

Required CLI args:

- `--corpus`
- `--collection`
- `--release-id`
- `--output-root`
- `--operator`

Optional CLI args:

- `--backup-reason`

Behavior:

- Reads `{corpus}/releases/{collection}/{release_id}/index-release.json`.
- Verifies the serving alias, points count, and release payload against the
  release manifest.
- Creates a collection snapshot for that release's physical collection.
- Writes the bundle under
  `<output-root>/<corpus>/<collection>/<release_id>/<backup_id>/`.
- Writes `backup-manifest.json`, `sha256.txt`, and `restore-command.txt`.
- Deletes the temporary snapshot from Qdrant after the filesystem bundle is
  written.

### `qdrant_gc_check`

Operator-facing gate check for old physical collection cleanup.

Required CLI args:

- `--corpus`
- `--collection`
- `--release-id`
- `--backup-root`

Optional CLI args:

- `--protected-physical-collection-name`
- `--manual-blocker`

Behavior:

- Loads the target release manifest and compares it with live alias state.
- Evaluates whether the target is `current` / `previous` / `migration_baseline`
  / `archive_candidate`.
- Requires validation summary and qdrant-native filesystem snapshot bundle
  evidence under `--backup-root` before reporting `eligible=true`.
- Does not delete anything; it only emits a structured gate report.

### Source-Truth Fan-Out Rule

Phase 03.2 freezes the worker/runtime direction as:

`single source consumption + multi-projection fan-out`

Meaning:

- one raw asset is consumed once into canonical source truth
- one replay boundary is persisted once across the source/derived boundary
- all downstream handbook outputs fan out from that source truth through
  repo-tracked projection declarations
- later collection work must not return to raw once canonical source truth
  already exists; do not return to raw

Current handbook projection declaration entrypoint:

- `configs/ingestion/regulations/student_rules/source-projections.v1.json`

Current known downstream families include:

- `regulations/student_rules` primary document projection
- handbook-derived `campus_services/contact_directory`
- handbook-derived `campus_services/service_catalog`
- future appendix / form / navigation-like derived documents when they are
  explicitly declared

### `campus_ingestion_worker.build_service_guide_projection`

Builds and publishes the handbook-derived `campus_services/service_guide`
projection from a repo-owned curated flow graph JSON artifact.

Required CLI args:

- `--curated-flow-graph`
- `--work-dir`
- `--release-id`
- `--effective-from`
- `--effective-until`

Optional CLI args:

- `--generated-at`
- `--derived-bucket`
- `--expected-ready-records`

Behavior:

- Reads `handbook_curated_service_flow_graph.v1` JSON.
- Builds `campus_services_service_guide_projection.v1` records.
- Fails before publishing if validation fails or any record still needs manual
  review.
- Writes local release artifacts and publishes versioned/current projection
  artifacts to the derived bucket.
- When `CAMPUS_SHARED_POSTGRES_URL` is configured, publishes the same validated
  release to PostgreSQL release catalog, current pointer, and `service_guide`
  typed read-model tables.

### `campus_ingestion_worker.build_service_catalog_projection`

Builds and publishes the `campus_services/service_catalog` projection from an
existing `service_guide` current projection and an optional `contact_directory`
current projection.

Required CLI args:

- `--service-guide-projection`
- `--work-dir`

Optional CLI args:

- `--contact-directory-projection`
- `--release-id`
- `--generated-at`
- `--derived-bucket`

Behavior:

- Reads normalized projection JSON files only.
- Builds `campus_services_service_catalog_projection.v1` service entries.
- Links service guide entry/contact labels to stable contact directory records
  when exact normalized aliases match.
- Writes local release artifacts and publishes versioned/current projection
  artifacts to the derived bucket.

### Removed authenticated notice bundle selector

The authenticated notice bundle selector Python worker entrypoint has been
removed. Selection must be expressed as task admission input or fixture data for
tests, not as a retained Python CLI.

### Authenticated Notice Object-Native Import

The authenticated notice collector -> worker handoff is object-native.

Mainline worker inputs:

- `--run-id`
- or explicit object refs:
  - `--source-bucket`
  - `--bundle-object-key`
  - `--bundle-content-sha256`
  - `--bundle-byte-size`
  - `--manifest-object-key`
  - `--manifest-content-sha256`
  - `--manifest-byte-size`

`--run-id` resolves through the Python-readable collector run ledger contract:

- source surface
- source bucket
- bundle / manifest object refs
- hash / byte-size verification fields
- run status and verification summary

Local `--bundle-path` / `--manifest-path` import is fixture/dev-only. Production
and Docker-compatible examples must use `--run-id` or explicit object refs.
Bare local path invocation fails closed unless `--allow-local-fixture-import`
is supplied.

Notice run-ledger import:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.import_authenticated_notice_export \
  --run-id muc_internal_portal:notice:20260402T235919838Z \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn/page/11 \
  --consumer-admission-manifest-path \
  /etc/campus-agent/internal-notice-consumer-admission-manifest.json
```

Notice explicit object-ref import:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.import_authenticated_notice_export \
  --source-bucket campus-rag-source \
  --bundle-object-key authenticated_notice/exports/run-1/notices-bundle.json \
  --manifest-object-key authenticated_notice/exports/run-1/manifest.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn/page/11 \
  --mode plan
```

File-release run-ledger import:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.import_authenticated_notice_file_release_export \
  --run-id muc_internal_portal:file_release:20260412T003300Z \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn/page/11 \
  --mode plan
```

`file_release` import uses the same handoff posture. Only
`released_file.storage_provider=object_store` rows with verified
`bucket/object_key/sha256/byte_size` can enter
`authenticated_documents/file_release_source`; `reference_only` rows remain
capture evidence and do not enter document holding.

`show_authenticated_document_holding_status --collection file_release_source`
reports `holding_stage` for each file release:
`captured_only`, `object_backed_source_ready`, `imported_holding`, or
`downstream_admitted`. The last state is only an observed downstream admission
signal; it does not open query-serving by default.

Dry-run / plan mode must not write object store, registry, projection, read
model, current pointer, or admission lifecycle state.

### Authenticated Notice Ingest Queue

Authenticated notice queue automation uses a run-level parent job and
consumer-owned child task evidence.

Primary commands:

- `campus_ingestion_worker.enqueue_authenticated_notice_collector_run`
- `campus_ingestion_worker.consume_authenticated_notice_ingest_queue`

The parent queue payload remains `authenticated_notice_ingest_job.v1`; it only
identifies a verified collector run and object refs. It must not carry body text,
HTML, OCR payloads, attachment bytes, local paths, projection rows, or read-model
rows.

The queue consumer emits child task evidence under its operations directory:

- `source_unit_import`
- `media_candidate_evaluation`
- `ocr_table_extraction`
- `multimodal_enrichment`
- `fact_readiness_evaluation`
- `target_admission`
- `downstream_materialization`
- `cleanup_evaluation`
- `smoke_assertion`

Child task states are `pending`, `running`, `completed`, `skipped`,
`failed_retryable`, `failed_terminal`, `manual_review`, and `cancelled`.
Operator summaries include counts by child task kind, state, processor profile,
highest severity, and the blocked task reason code.

Processor profile rules:

- `text_notice` consumes body facts first and does not choose multimodal first.
- `image_schedule_notice` uses OCR/table extraction before generic multimodal.
- `attachment_owner_text_notice` starts from object-backed owner text.
- `mixed_notice` handles body/media/attachment facts with explicit escalation.

For schedule/table image facts such as notice `355867`, OCR/table extraction is
the default first processor. Generic multimodal is only an explicit escalation
when OCR is low-confidence, extracts no valid rows, lacks route/date context, or
the media is semantic image content rather than table-shaped OCR content.

Captured-content contract coverage belongs in repeatable integration tests, not
in a public Python smoke console script.

### `campus_ingestion_worker.admit_schedule_image_ocr_results`

Admits reviewed schedule-image OCR dry-run results into source/derived
artifacts for selected notices.

Required CLI args:

- `--ocr-output-dir`
- `--notice-id` (repeatable; selected notices only)
- `--consumer-admission-manifest-path`
- `--run-id`
- `--generated-at`

Optional CLI args:

- `--mode`:
  - `plan`: evaluates admission and prints the document ids that would be
    materialized; no object-store, registry, or attempt-store writes.
  - `admit-and-materialize`: writes source OCR artifacts, derived child
    document artifacts, document-registry records, and OCR attempt records.
- `--source-bucket`
- `--derived-bucket`

Behavior:

- Requires the consumer admission manifest gate for typed materialization.
- Only processes explicitly selected notice ids from the OCR dry-run output.
- Materializes admitted schedule-table OCR outputs as
  `notice_attachment:...:schedule-ocr` child documents.
- Does not build or promote a `transport_schedule` release; run
  `campus_ingestion_worker.build_transport_schedule_projection` separately in
  `preview` or `stage` mode after admission.

### `campus_ingestion_worker.build_transport_schedule_projection`

Builds and publishes the `campus_services/transport_schedule` projection.

Preferred notice-derived mode:

- `--from-consumption-projection`
- `--notice-id` (repeatable; selected notices only)
- `--selection-path`
- `--all-ready-transport-candidates`
- `--work-dir`
- `--release-id`
- `--consumer-admission-manifest-path`

Legacy source-truth smoke mode:

- `--source-truth-inventory`
- `--source-truth-root` or source object-store env
- `--work-dir`
- `--release-id`

Optional CLI args:

- `--publish-mode`:
  - `preview`: writes local artifacts only; no object-store writes and no PG
    release/read-model writes.
  - `stage`: writes versioned artifacts and PG release/read-model rows, but does
    not write current artifacts or update `structured_projection_current`.
  - `promote`: writes versioned/current artifacts and updates PG current pointer.
- `--allow-multi-notice-release`: allows `stage` / `promote` from more than one
  notice id or from `--all-ready-transport-candidates`. Without it, write modes
  require exactly one selected notice id.
- `--transport-preview-gate-report-path`: required for notice-derived `stage` /
  `promote`; points at the no-write transport preview gate report that passed
  the selected notices.

Behavior:

- Notice-derived mode reads ready
  `campus_services/service_status_candidate` consumption projection entries.
- Notice-derived mode requires a consumer admission manifest and checks the
  `typed-materialization` gate before reading selected entries.
- `preview` can use `--all-ready-transport-candidates` for local evidence, but
  `stage` / `promote` must be scoped to a single notice unless
  `--allow-multi-notice-release` is explicitly supplied.
- It reads OCR child `document-units.jsonl` from the derived bucket, cleans table
  context, and publishes `campus_services_projection_bundle.v1`.
- It materializes supported timetable rows, service exceptions, operational
  notices such as boarding-point changes, and rejected-source records into the
  same projection bundle.
- It records release-notice provenance, including source notice release time,
  admission time and materialization time when the notice-derived path supplies
  a consumer admission manifest. Source notice release time is normalized to a
  timezone-qualified Shanghai local ISO timestamp before PG typed materialization.
- `preview` is the required mode for single-notice validation; `stage` is for
  selected-write evidence; only complete approved releases should use `promote`.
- Selected batch `stage` / `promote` must be based on a prior no-write transport
  preview gate. The gate writes `release-write-plan.json` to explain which
  passed notices will be written as current serving rows, historical
  snapshot-only rows, or operational/exception rows.
- Notice-derived `stage` / `promote` refuses to run unless every selected notice
  id is present in the preview gate's `preview_passed` bucket and absent from
  `preview_failed_skip`.
- `snapshot_only_superseded_baseline` is an accepted warning only when the
  projection produced a non-current, unbounded `baseline_revision` snapshot and
  no serving rows. Those notices are staged as historical snapshot provenance;
  they must not be promoted alone or used to answer the current timetable.
- A current snapshot with no departures, service exceptions, or operational
  notices is a preview failure, not an accepted warning.
- It does not open `transport_schedule_lookup` serving by itself.

### `campus_ingestion_worker.manage_structured_projection_release`

Operator shell for PostgreSQL structured projection release pointers.

Required CLI args:

- `--collection` (`service_status`, `service_guide`, or `transport_schedule`)
- subcommand: `current`, `list`, or `promote`

Optional CLI args:

- `--corpus` (defaults to `campus_services`)
- `--limit` for `list`
- `--release-id` for `promote`

Behavior:

- Reads `CAMPUS_SHARED_POSTGRES_URL`.
- `current` prints the PG current pointer.
- `list` prints recent release catalog rows.
- `promote` verifies the target release exists for the selected corpus /
  collection, then updates `structured_projection_current` transactionally.
- It does not read or promote mounted projection files.

### `campus_ingestion_worker.smoke_structured_projection_postgres`

Internal PostgreSQL smoke module for structured campus-service projections.

Optional CLI args:

- `--release-id`
- `--generated-at`

Behavior:

- Publishes small `service_status`, `transport_schedule`, and `service_guide`
  smoke releases to the PG release catalog and typed read-model tables.
- Verifies that each collection's current pointer resolves to the smoke release.
- Intended for local `open_structured` runtime smoke and deployment readiness
  checks. It requires a real PG URL and does not create file-based projection
  fixtures.

### `migrate_student_handbook_source_faithful`

Worker shell for the handbook source-faithful migration.

This is a narrow legacy migration shell retained for handbook canonical-rename
recovery, not part of the default operator path.

Required CLI args:

- `--raw-version-id`

Optional CLI args:

- `--raw-asset-id`
- `--canonical-raw-filename`

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `DOCUMENT_REGISTRY_DATABASE_URL`

Optional env:

- `RAW_ASSET_REGISTRY_DATABASE_URL`
- `INGESTION_SPLIT_MANIFEST_PATH`
- `REBUILD_RESET_QDRANT`
- `REBUILD_INDEX_QDRANT`

Command override example:

- `env/commands/historical/migrate-student-handbook.env.example`

Behavior:

- Renames the handbook raw PDF object and raw-asset registry record to the
  canonical filename.
- Preserves asset-level `provider-response.jsonl`.
- Clears old handbook derived artifacts and rebuilds `layout-elements.jsonl`,
  `canonical.md`, and `document-units.jsonl` under `regulations/documents/studen
  t_rules/{title_slug}--{docid8}/{revision_track}/{year}/...`.
- Refreshes document-registry rows via `provider_response_replay`.
- Raw version identity is now passed as typed request input; repo-tracked
  collection truth resolves the split manifest by default, and
  `INGESTION_SPLIT_MANIFEST_PATH` remains only as an explicit override.

Example:

```bash
python -m campus_ingestion_worker.migrate_student_handbook_source_faithful \
  --raw-version-id sha256:...
```

### `validate_student_handbook_chunking`

Read-only validation shell for the real `regulations/student_rules` chunking
inputs and outputs.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `DOCUMENT_REGISTRY_DATABASE_URL`

Optional env:

- `OBJECT_STORE_BUCKET_DERIVED`
- `INGESTION_SPLIT_MANIFEST_PATH`

Behavior:

- Loads the repo-tracked handbook split manifest, or
  `INGESTION_SPLIT_MANIFEST_PATH` when explicitly provided.
- Reads `regulations/student_rules` records from the document registry and
  selects the current `source-faithful` version per document.
- Verifies `document-units.jsonl` exists in the derived bucket and can be
  converted into indexable chunks without running embeddings.
- Reports manifest/registry drift, stale registry entries, read failures,
  chunk-build failures, non-table oversize chunks, and structure-first
  eligibility statistics.
- Does not write MinIO, registry, or Qdrant state.

### `analyze_authenticated_notice_notice_families`

Read-only family-analysis shell for authenticated notice donor bundles.

Required CLI args:

- `--bundle-path`

Optional CLI args:

- `--config-path`
- `--sample-limit`
- `--output-path`

Behavior:

- Loads the repo-tracked `internal_notice` notice-family config by default.
- Classifies donor bundle records into repo-owned notice families such as
  `policy_regulation`, `operational_procedure`, `event_activity`, and
  `lecture_publicity`.
- Reports family counts, `priority_now_notice_count`, and representative matched
  samples.
- Can persist one machine-readable JSON report with `--output-path`.
- Does not write object store, registry, embedding, or Qdrant state.

### `normalize_authenticated_notice_legacy_export`

Local normalization shell for `rag-data` authenticated notice historical donor
exports.

Required CLI args:

- `--bundle-path`
- `--site-id`
- `--source-home-url`
- `--output-dir`

Optional CLI args:

- `--manifest-path`
- `--notice-types-path`
- `--selection-path`
- `--notice-id`
- `--export-scope`

Behavior:

- Reads a donor legacy bundle and optional donor export manifest.
- Applies a repo-tracked selected notice set when `--selection-path` or
  `--notice-id` is provided.
- Snapshots the legacy collector notice-type policy into a repo-owned normalized
  manifest.
- Writes `notices-bundle.normalized.json`, `export-manifest.normalized.json`,
  and `normalization-summary.json` under the target output dir.
- Does not write object store, Postgres, embedding, or Qdrant state.

### Removed authenticated notice browser URL backfill CLIs

The authenticated notice browser URL backfill and bundle-audit Python worker
entrypoints have been removed. Browser URL derivation that is still required by
canonical source-truth artifact generation remains in `campus_ingestion_core`;
historical bundle rewriting should be rebuilt as an admitted ingestion-control
task if it becomes necessary again.
The removed CLIs did not own source-truth import, object-store mutation,
Postgres writes, embedding, or query-serving publication.

### `campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest`

Builds the collector-facing attachment fetch request manifest from authenticated
notice source-truth inventory and `source-truth/attachment-refs.jsonl`.

Useful local command:

```bash
FETCH_MANIFEST_MODULE=\
campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest
uv run --all-packages python -m "$FETCH_MANIFEST_MODULE" \
  --corpus campus_notices \
  --collection internal_notice \
  --notice-id 355867 \
  --output-path \
    .tmp/authenticated-notice-fetch-admission/355867/fetch-request-manifest.json
```

Behavior:

- Reads source-truth inventory rows and their attachment refs from the source
  object bucket.
- Emits `authenticated_notice_attachment_fetch_request_manifest_v1`.
- Includes only `fetch_to_quarantine`, `fetch_required_for_source_truth`, and
  `fetch_required_for_admitted_owner` attachment refs.
- Omits `metadata_only` refs so ordinary notice discover/card attachments do not
  get downloaded by the collector.
- Fails when explicit `--notice-id` values are absent from source-truth
  inventory, instead of silently creating an empty admission manifest.

### `campus_ingestion_worker.check_authenticated_notice_reference_only_attachments`

Checks source-truth inventory rows whose attachment refs did not produce child
attachment documents and explains why each ref is still `reference_only`.

Required readable state:

- authenticated notice source-truth inventory PG table
- authenticated notice attachment fetch-status PG table
- source object bucket containing `source-truth/attachment-refs.jsonl`

Useful local command:

```bash
CHECKER=campus_ingestion_worker.check_authenticated_notice_reference_only_attachments
uv run --all-packages python -m "$CHECKER" \
  --site-id muc_internal_portal \
  --corpus campus_notices \
  --collection internal_notice
```

The JSON report separates terminal portal misses, object-backed inline images
that intentionally stay non-document, and action-required gaps such as missing
object keys or transient fetch failures.

### `campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment`

Thin worker shell for service-backed authenticated notice legacy Office
normalization.

Required CLI args:

- `--input-path`
- `--output-dir`

Optional CLI args:

- `--source-object-key`
- `--source-sha256`
- `--source-mime-type`
- `--normalized-object-key`

Required env:

- `LEGACY_OFFICE_CONVERSION_BASE_URL`
- `LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET`

Optional env:

- `LEGACY_OFFICE_CONVERSION_TIMEOUT_SECONDS`

Command override example:

- `env/commands/legacy-office-conversion-service.env.example`

Behavior:

- Accepts `.doc` or `.xls` attachment input and delegates normalization to `POST
  /api/internal/legacy-office/conversions`.
- Uses `x-app-internal-auth` shared-secret admission and fails closed when the
  service is unreachable, misconfigured, or returns an invalid payload.
- Writes the normalized `.docx` or `.xlsx` artifact under `--output-dir` and
  prints the canonical normalization outcome JSON.
- Does not shell out to local `soffice` and does not own LibreOffice process
  lifecycle.

### `smoke_authenticated_notice_bootstrap_local`

Local-only bootstrap smoke shell for one normalized authenticated notice donor
batch.

Required CLI args:

- `--bundle-path`
- `--site-id`
- `--source-home-url`
- `--local-output-dir`

Optional CLI args:

- `--manifest-path`
- `--attachment-blob-root`
- `--corpus`
- `--collection`
- `--entitlement-group`
- `--visibility-scope`
- `--expect-notice-count`
- `--summary-output-path`

Behavior:

- Reuses the authenticated notice importer but injects a local filesystem object
  store and in-memory registries.
- When donor attachments are still referenced by legacy blob-store keys,
  `--attachment-blob-root` materializes canonical attachment capture objects
  before inventory routing is evaluated.
- Materializes source-bucket and derived-bucket artifacts under
  `--local-output-dir` only.
- Persists local `documents.json`, `raw-assets.json`,
  `source-truth-inventory.json`, and `uploads.json` for inspection.
- Produces a smoke summary with notice/document/raw-asset outcome counts.
- Does not touch the real object store, Postgres, embedding provider, Qdrant, or
  serving aliases.

### `validate_internal_notice_chunking`

Read-only validation shell for `campus_notices/internal_notice` offline
preparation quality.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `DOCUMENT_REGISTRY_DATABASE_URL`

Optional CLI args:

- `--preparation-run-id`
- `--mode full|samples`
- `--sample-dir`
- `--sample-seed`

Behavior:

- Reads current `campus_notices/internal_notice` `source-faithful` current
  records, or an explicit frozen preparation manifest when
  `--preparation-run-id` is provided.
- Rebuilds chunks from repo-owned `document-units.jsonl` without embeddings.
- Validates lane metadata, title/context propagation, attachment lineage,
  notice-body fragmentation, OCR noise suspects, and markup leakage.
- Can export lane-specific chunk samples for operator or agent review.
- Does not write registry, embedding, or Qdrant state.

- Imports active `service_portal` documents into
  `campus_services/service_catalog`.
- Imports `中央民族大学校内常用电话` into `campus_services/contact_directory`.
- Derives handbook navigation pages declared in
  `configs/ingestion/regulations/student_rules/source-projections.v1.json` from
  `regulations/student_rules` source-level OCR truth into `service_catalog`.
- This command is a historical backfill bridge, not a canonical current
  ingestion path.
- The canonical declaration of handbook downstream projections lives under
  `configs/ingestion/regulations/student_rules/source-projections.v1.json`.
- For handbook-derived `campus_services` outputs, source-truth selector fields
  (`source_title`, `source_handbook_section`, `source_page_start`,
  `source_page_end`) are now the canonical match contract; do not require
  retained `regulations/student_rules` manifest document ids for pages already
  removed from the handbook split manifest.
- New downstream outputs must be added to source-truth fan-out, not to this
  bridge.
- Rewrites migrated canonical metadata into `campus_services` corpus semantics.
- Deletes stale `regulations/student_rules` phone-directory and migrated
  handbook navigation document artifacts.
- Only writes derived-bucket `canonical.md` artifacts and targeted cleanup.
- Does not touch registry, Qdrant, retrieval routing, or default query scopes.
