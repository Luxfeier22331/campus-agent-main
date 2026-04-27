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

### `campus-ingestion-official-web-handoff-dev`

Local `official_web` handoff receiver for `app-api -> ingestion-worker` seam
verification.

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

### `campus-ingestion-consume-official-web-handoffs`

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
- `--declarations-path`

Command override example:

- `env/commands/official-web-handoff-consumer.env.example`

Behavior:

- Reads durable inbox records written by
  `campus-ingestion-official-web-handoff-dev`
- Resolves `source_truth_bundle` from handoff `artifacts`; if absent, falls back
  to the deterministic run artifact key
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
- Updates each inbox record with `processingStatus`, `processingAttemptCount`,
  `processedAt`, `lastError`, `executionReportPath`, `projectionOutputDir`, and
  `replayInputDir`
- `processingStatus` now distinguishes `staged`, `promoted`, and `failed`

### `campus-ingestion-import-official-web-projection`

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
  before running `campus-ingestion-release-registry-scope`

### `campus-ingestion-backfill-official-web-history`

Backfills missing historical `official_web` run artifacts from recoverable local
collector output into the source bucket.

This is a historical recovery shell, not part of the default operator path.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`

Optional env:

- `OBJECT_STORE_BUCKET_SOURCE`
- `INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_INBOX_DIR`

Optional CLI args:

- `--event-id`
- `--limit`
- `--local-output-glob`
- `--dry-run`

Command override example:

- `env/commands/historical/official-web-history-backfill.env.example`

Behavior:

- Inventories historical inbox records against source-bucket
  `source-truth-bundle.json` availability
- Reuses recoverable local collector outputs instead of introducing worker-local
  `/tmp` fallback into runtime execution
- Uploads canonical run artifacts under `official_web/{siteId}/runs/{runId}/...`
- Uploads canonical source assets under
  `official_web/{rawAssetId}/undated/{rawVersionId}/...`
- Rewrites the durable inbox payload `artifacts` array so later offline
  execution can consume the canonical object-store refs

### `campus-ingestion-audit-collection-runtime-state`

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
  - typed PDF: `MinerU primary -> Paddle fallback`
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

### `campus-ingestion-release-registry-scope`

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

### `campus-ingestion-materialize-curriculum-program-semester-facts`

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
  `campus-ingestion-release-registry-scope`
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

### `campus-ingestion-audit-official-web-projection-chunking`

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

### `qdrant_backup_create`

Operator-facing backup shell for one release-managed Qdrant collection snapshot
bundle.

Required CLI args:

- `--corpus`
- `--collection`
- `--release-id`
- `--backup-reason`

Optional CLI args:

- `--operator`

Behavior:

- Reads `{corpus}/releases/{collection}/{release_id}/index-release.json`.
- Creates a collection snapshot for that release's physical collection.
- Uploads the snapshot to
  `{corpus}/backups/{collection}/{release_id}/{backup_id}/...`.
- Writes `backup-manifest.json` with alias binding, checksum, manifest key, and
  operator metadata.

### `qdrant_backup_restore`

Operator-facing restore shell for one previously exported snapshot bundle.

Required CLI args:

- `--corpus`
- `--collection`
- `--release-id`
- `--backup-id`

Optional CLI args:

- `--operator`
- `--target-collection-name`
- `--apply-alias`

Behavior:

- Downloads one snapshot bundle from derived bucket.
- Restores the physical collection into Qdrant Cloud.
- Verifies collection existence, points count, and release payload metadata.
- Only reapplies serving alias when `--apply-alias` is enabled and verification
  passes.
- Writes `restore-report.json` back to the same backup prefix.

### `qdrant_gc_check`

Operator-facing gate check for old physical collection cleanup.

Required CLI args:

- `--corpus`
- `--collection`
- `--release-id`

Optional CLI args:

- `--protected-physical-collection-name`
- `--manual-blocker`

Behavior:

- Loads the target release manifest and compares it with live alias state.
- Evaluates whether the target is `current` / `previous` / `migration_baseline`
  / `archive_candidate`.
- Requires validation summary and snapshot bundle evidence before reporting
  `eligible=true`.
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

### `campus-ingestion-build-service-guide-projection`

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

### `campus-ingestion-build-service-catalog-projection`

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

### `campus-ingestion-build-transport-schedule-projection`

Builds and publishes the `campus_services/transport_schedule` projection.

Preferred notice-derived mode:

- `--from-consumption-projection`
- `--notice-id` (repeatable; selected notices only)
- `--work-dir`
- `--release-id`

Legacy source-truth smoke mode:

- `--source-truth-inventory`
- `--source-truth-root` or source object-store env
- `--work-dir`
- `--release-id`

Behavior:

- Notice-derived mode reads ready
  `campus_services/service_status_candidate` consumption projection entries.
- It reads OCR child `document-units.jsonl` from the derived bucket, cleans table
  context, and publishes `campus_services_projection_bundle.v1`.
- It writes local release artifacts and publishes versioned/current projection
  artifacts to the derived bucket.
- When `CAMPUS_SHARED_POSTGRES_URL` is configured, publishes the same validated
  release to PostgreSQL release catalog, current pointer, and
  `transport_schedule` typed read-model tables.
- It does not open `transport_schedule_lookup` serving by itself.

### `campus-ingestion-manage-structured-projection-release`

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

### `campus-ingestion-smoke-structured-projection-postgres`

Real PostgreSQL smoke for structured campus-service projections.

Optional CLI args:

- `--release-id`
- `--generated-at`

Behavior:

- Publishes small `service_status`, `transport_schedule`, and `service_guide`
  smoke releases to the PG release catalog and typed read-model tables.
- Verifies that each collection's current pointer resolves to the smoke release.
- Intended for local `open_structured` runtime smoke and deployment readiness
  checks. It requires a real PG URL and does not create file fallback fixtures.

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

### `campus-ingestion-backfill-authenticated-notice-browser-urls`

Bundle-level audit/backfill shell for authenticated notice browser URL metadata.

Required CLI args:

- `--bundle-path`
- `--source-home-url`
- `--summary-output-path`

Optional CLI args:

- `--bundle-output-path`

Behavior:

- Adds `portal_print_url`, `notice_browser_url`, and
  `notice_browser_url_source` to bundle notice rows when they are missing.
- Reports missing `notice_type` rows that cannot construct a portal print URL.
- Writes a normalized bundle only when `--bundle-output-path` is provided.
- Does not write object store, Postgres, embedding, or Qdrant state.

### `campus-ingestion-audit-authenticated-notice-browser-url-bundles`

Multi-bundle coverage audit/backfill shell for authenticated notice browser URL
metadata.

Required CLI args:

- one or more `--bundle-path`
- `--source-home-url`
- `--summary-output-path`

Optional CLI args:

- `--output-dir`

Behavior:

- Runs the same URL metadata backfill over each input bundle.
- Aggregates `records_seen`, present/backfilled counts, missing notice-type
  counts, unavailable counts, and URL source counts across all bundles.
- Writes backfilled bundle copies under `--output-dir` when provided.
- Does not import source truth, mutate object store, write Postgres, embed, or
  publish query-serving state.

### `campus-ingestion-check-authenticated-notice-reference-only-attachments`

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

### `campus-ingestion-normalize-authenticated-notice-legacy-office-attachment`

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
