# campus-ingestion-worker

Runtime shell for campus-agent v2 ingestion commands.

Env bootstrap rule:

- Worker CLI first reads `./.env` from the current repo/worktree root.
- If the current worktree has no `./.env`, worker CLI falls back to the main worktree root `.env`.
- Do not introduce local mock backends or file-registry compatibility paths just because a feature worktree is missing `.env`.

## Commands

`apps/ingestion-worker` exposes phase-1 ingestion shells.

- Query-facing defaults target `regulations/student_handbook`.
- Data-plane ingestion supports `regulations/student_handbook` and `curriculum/curriculum_plan`.
- Phase-1 runtime truth lives in `configs/ingestion/<corpus>/<collection>/runtime-profile.json`.
- Phase 03.2 freezes `single source consumption + multi-projection fan-out` as the canonical ingestion model: raw is consumed once, source truth is persisted once, and downstream outputs rebuild from declared projections instead of returning to raw.

### `process_raw_ingestion_job`

Worker shell for the production raw-first path.

Phase-2 canonical flow:

1. `register_raw_asset` uploads the handbook source PDF into the raw bucket and persists canonical raw-layer truth.
2. `process_raw_ingestion_job` consumes the registered `raw_asset_id + raw_version_id` instead of any local file path.

### `register_raw_asset`

Worker shell for canonical raw-asset registration.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `RAW_SOURCE_FILE`
- `RAW_SOURCE_URI`
- `RAW_ASSET_REGISTRY_DATABASE_URL` or `DOCUMENT_REGISTRY_DATABASE_URL`

Optional env:

- `RAW_ASSET_ID`
- `INGESTION_CORPUS`
- `INGESTION_COLLECTION`

Behavior:

- Computes `content_hash = sha256(file_bytes)` and `raw_version_id = sha256:<content_hash>`.
- Defaults `raw_asset_id` to `build_raw_asset_id(source_filename)` when no override is supplied.
- Writes the source PDF into the raw bucket under the canonical raw object key.
- Upserts raw-layer truth in the raw asset registry before OCR processing begins.
- Repeated registration of the same source filename and identical bytes reuses the existing raw-asset record.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `OCR_BASE_URL`
- `OCR_API_KEY`
- `RAW_ASSET_ID`
- `RAW_VERSION_ID`
- `RAW_ASSET_REGISTRY_DATABASE_URL` or `DOCUMENT_REGISTRY_DATABASE_URL`

Optional env:

- `DOCUMENT_REGISTRY_DATABASE_URL`
- `RAW_ASSET_REGISTRY_DATABASE_URL`
- `OCR_MODEL`
- `OCR_POLL_SECONDS`
- `OCR_TIMEOUT_SECONDS`
- `IMPORT_REPORT_DIR`
- `INGESTION_CORPUS`
- `INGESTION_COLLECTION`
- `INGESTION_SPLIT_MANIFEST_PATH`
- `RAW_INGESTION_ARTIFACT_MODE`
- `INGESTION_EMBEDDING_MODEL`
- `INGESTION_DEFAULT_CAMPUS_SCOPE`
- `HF_HOME` / `HF_HUB_CACHE` / `TRANSFORMERS_CACHE`
- `HF_HUB_OFFLINE`

Behavior:

- Reads the source PDF from the raw bucket using canonical raw-asset registry metadata.
- Does not accept local PDF paths or placeholder local job envelopes.
- Calls the async OCR provider.
- Raw objects live under `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...` and are intentionally not scoped by corpus because one raw asset may feed multiple corpora.
- Default `RAW_INGESTION_ARTIFACT_MODE=normalized` stores asset-level `provider-response.jsonl` and `layout-elements.jsonl`, persists canonical source truth, then fans out into declared downstream projections that may write per-document `canonical.md` and `document-units.jsonl`.
- Normalized and provider-only modes both keep processed source artifacts under `{corpus}/sources/{source_channel}/{source_asset_slug}/{year}/{ingest_id}/...`.
- Normalized mode writes processed document artifacts under `{corpus}/documents/{collection}/{title_slug}--{docid8}/{representation}/{year}/`.
- `RAW_INGESTION_ARTIFACT_MODE=provider_only` stores asset-level `provider-response.jsonl` only, and skips `canonical.md` / `document-units.jsonl` and document-registry writes.
- `provider_only` still writes canonical raw-asset provenance and should use the configured canonical raw-asset registry backend.
- Runtime-profile gating decides whether the selected `corpus + collection` accepts `normalized` or `provider_only`.
- `curriculum/curriculum_plan` may use `provider_only` as a pre-split onboarding path to inspect real OCR output before freezing its split manifest.
- For `INGESTION_CORPUS=regulations` + `INGESTION_COLLECTION=student_handbook` and `INGESTION_CORPUS=curriculum` + `INGESTION_COLLECTION=curriculum_plan`, normalized mode requires a split manifest and stores asset-level `provider-response.jsonl` / `layout-elements.jsonl` plus per-document `document-units.jsonl`; handbook also exports `canonical.md`.
- `regulations/student_handbook` normalized mode rebuilds logical documents strictly from the repo-tracked split manifest; no legacy OCR-import adapter or non-`provider-response.jsonl` handbook input is supported.
- `regulations/student_handbook` downstream fan-out is declared in `configs/ingestion/regulations/student_handbook/source-projections.v1.json`.
- When canonical source truth for the same source asset already exists, later collection work, handbook-derived service outputs, and attachment-derived outputs must rebuild from source truth through declared projections; do not return to raw.
- Attachment-bearing, appendix-bearing, form-like, and navigation-like handbook leaves may materialize as explicit derived documents when they have standalone downstream value.
- Handbook retrieval preparation stays ingestion-owned: persisted `document-units.jsonl` feeds chunk generation in `packages/ingestion-core`, and `index_chunks_to_qdrant()` writes the canonical online chunk/index state into Qdrant.
- `regulations/student_handbook` chunk budgeting uses the `Qwen/Qwen3-Embedding-4B` tokenizer from local Hugging Face cache only. Prefetch it explicitly with `uv run --all-packages python -m campus_ingestion_core.prefetch_tokenizer`, then keep worker/runtime/test runs on `HF_HUB_OFFLINE=1`; the ingestion code no longer falls back to implicit network download.
- Only normalized mode registers processed results in the document registry with `import_source=raw_online_ocr`.
- Normalized document-registry writes persist the scope cleaning policy version for traceability.
- Phase-1 OCR ingestion defaults to `representation=source-faithful`, `source_channel=pdf_ocr`, `is_current=false`.

### `rebuild_local_data`

Corpus-scoped rebuild shell for MinIO + registry.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `REBUILD_IMPORT_MODE`

Optional env:

- `INGESTION_CORPUS`
- `INGESTION_COLLECTION`
- `DOCUMENT_REGISTRY_DATABASE_URL`
- `RAW_ASSET_REGISTRY_DATABASE_URL`
- `REBUILD_RESET_QDRANT`
- `REBUILD_INDEX_QDRANT`
- `REBUILD_PROVIDER_RESPONSE_KEY`
- `REPLAY_SOURCE_PDF`
- `INGESTION_SPLIT_MANIFEST_PATH`
- Any env required by the selected import mode

Behavior:

- `raw_online_ocr` deletes only the selected processed scope prefix and the raw assets explicitly selected by registry identity.
- `raw_online_ocr` deletes only the selected scope records from the document/raw-asset registry.
- Dispatches to `process_raw_ingestion_job` when `REBUILD_IMPORT_MODE=raw_online_ocr`.
- Dispatches to source-truth replay rebuild when `REBUILD_IMPORT_MODE=provider_response_replay`.
- `provider_response_replay` preserves raw bucket provenance and raw-asset registry provenance.
- `provider_response_replay` reads an existing object-store `provider-response.jsonl`, rewrites asset-level `layout-elements.jsonl`, rebuilds persisted source truth, and re-emits declared projections such as per-document `canonical.md` / `document-units.jsonl` without synthesizing raw-layer records.
- handbook replay默认 `REPLAY_SOURCE_PDF=学生手册_2018.pdf`；兼容 `student-handbook.pdf` 仅用于迁移。
- `provider_response_replay` does not index Qdrant by default; set `REBUILD_INDEX_QDRANT=1` when replay should also rebuild chunk/embedding/vector state.
- `REBUILD_RESET_QDRANT` and `REBUILD_INDEX_QDRANT` are independent: reset only clears the collection, while replay indexing is opt-in.
- `provider_response_replay` is the canonical rebuild boundary for downstream fan-out; later projection work must not create handbook-only replay branches or separate raw re-consumption lanes.

### Source-Truth Fan-Out Rule

Phase 03.2 freezes the worker/runtime direction as:

`single source consumption + multi-projection fan-out`

Meaning:

- one raw asset is consumed once into canonical source truth
- one replay boundary is persisted once at the processed/source-truth layer
- all downstream handbook outputs fan out from that source truth through repo-tracked projection declarations
- later collection work must not return to raw once canonical source truth already exists; do not return to raw

Current handbook projection declaration entrypoint:

- `configs/ingestion/regulations/student_handbook/source-projections.v1.json`

Current known downstream families include:

- `regulations/student_handbook` primary document projection
- handbook-derived `campus_services/contact_directory`
- handbook-derived `campus_services/service_catalog`
- future appendix / form / navigation-like derived documents when they are explicitly declared

### `migrate_student_handbook_source_faithful`

Worker shell for the handbook representation migration.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `DOCUMENT_REGISTRY_DATABASE_URL`
- `INGESTION_SPLIT_MANIFEST_PATH`
- `REBUILD_PROVIDER_RESPONSE_KEY`

Optional env:

- `RAW_ASSET_REGISTRY_DATABASE_URL`
- `HANDBOOK_CANONICAL_RAW_FILENAME`
- `REBUILD_RESET_QDRANT`
- `REBUILD_INDEX_QDRANT`

Behavior:

- Renames the handbook raw PDF object and raw-asset registry record to the canonical filename.
- Preserves asset-level `provider-response.jsonl`.
- Clears old handbook processed artifacts and rebuilds `layout-elements.jsonl`, `canonical.md`, and `document-units.jsonl` under `regulations/documents/student_handbook/{title_slug}--{docid8}/source-faithful/{year}/...`.
- Refreshes document-registry rows via `provider_response_replay`.

Example:

```bash
python -m campus_ingestion_worker.process_raw_ingestion_job
```

### `validate_student_handbook_chunking`

Read-only validation shell for the real `regulations/student_handbook` chunking inputs and outputs.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `DOCUMENT_REGISTRY_DATABASE_URL`

Optional env:

- `OBJECT_STORE_BUCKET_PROCESSED`
- `INGESTION_SPLIT_MANIFEST_PATH`

Behavior:

- Loads the repo-tracked handbook split manifest, or `INGESTION_SPLIT_MANIFEST_PATH` when explicitly provided.
- Reads `regulations/student_handbook` records from the document registry and selects the current `source-faithful` version per document.
- Verifies `document-units.jsonl` exists in the processed bucket and can be converted into indexable chunks without running embeddings.
- Reports manifest/registry drift, stale registry entries, read failures, chunk-build failures, non-table oversize chunks, and structure-first eligibility statistics.
- Does not write MinIO, registry, or Qdrant state.

### `migrate_campus_services_canonical`

Worker shell for offline-only `campus_services` canonical markdown backfill.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `CAMPUSRAG_CANONICAL_ROOT`
- `DOCUMENT_REGISTRY_DATABASE_URL`

Optional env:

- `OBJECT_STORE_BUCKET_PROCESSED`
- `RAW_ASSET_REGISTRY_DATABASE_URL`
- `HANDBOOK_DERIVED_DOCUMENTS_CONFIG_PATH`

Behavior:

- Reads canonical markdown from legacy `campusRAG/rag-data/canonical`.
- Imports active `service_portal` documents into `campus_services/service_catalog`.
- Imports `中央民族大学校内常用电话` into `campus_services/contact_directory`.
- Derives handbook navigation pages declared in
  `configs/ingestion/campus_services/service_catalog/handbook-derived-documents.json`
  from `regulations/student_handbook` source-level OCR truth into `service_catalog`.
- This command exists as a legacy/offline bridge. Phase 03.2 freezes the long-term direction as source-truth fan-out from handbook source truth, not a permanent separate `campus_services` migration lane.
- The canonical declaration of handbook downstream projections now lives under
  `configs/ingestion/regulations/student_handbook/source-projections.v1.json`; this command is expected to converge onto that contract instead of remaining the long-term source of truth.
- Rewrites migrated canonical metadata into `campus_services` corpus semantics.
- Deletes stale `regulations/student_handbook` phone-directory and migrated handbook
  navigation document artifacts.
- Only writes processed-bucket `canonical.md` artifacts and targeted cleanup.
- Does not touch registry, Qdrant, retrieval routing, or default query scopes.
