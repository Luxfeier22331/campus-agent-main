# campus-ingestion-worker

Runtime shell for campus-agent v2 ingestion commands.

Env bootstrap rule:

- Worker CLI first reads `./.env` from the current repo/worktree root.
- If the current worktree has no `./.env`, worker CLI falls back to the main worktree root `.env`.
- Do not introduce local mock backends or file-registry compatibility paths just because a feature worktree is missing `.env`.

## Commands

`apps/ingestion-worker` exposes ingestion runtime shells.

- Query-serving scope is controlled by `configs/ingestion/<corpus>/<collection>/runtime-profile.json`, not by worker defaults.
- Data-plane ingestion currently covers `regulations/student_handbook` and `curriculum/curriculum_plan`.
- Current runtime truth lives in `configs/ingestion/<corpus>/<collection>/runtime-profile.json`.
- Phase 03.2 freezes `single source consumption + multi-projection fan-out` as the canonical ingestion model: a source asset is consumed once, source truth is persisted once, and downstream outputs rebuild from declared projections instead of returning to the original PDF.
- Serving/indexing terms follow `docs/reference/runtime-serving-and-index-terms.md`.
- Operator release flow follows `docs/runbooks/index-release-runbook.md`.

### `process_raw_ingestion_job`

Worker shell for the production raw-first path.

Phase-2 canonical flow:

1. `register_raw_asset` uploads the handbook source PDF into the source bucket and persists canonical raw-layer truth.
2. `process_raw_ingestion_job` consumes the registered `raw_asset_id + raw_version_id` instead of any local file path.

### `register_raw_asset`

Worker shell for canonical raw-asset registration.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `RAW_ASSET_REGISTRY_DATABASE_URL` or `DOCUMENT_REGISTRY_DATABASE_URL`

Required CLI args:

- `--pdf-path`
- `--raw-source-uri`
- `--corpus`
- `--collection`

Optional CLI args:

- `RAW_ASSET_ID`

Behavior:

- Computes `content_hash = sha256(file_bytes)` and `raw_version_id = sha256:<content_hash>`.
- Defaults `raw_asset_id` to `build_raw_asset_id(source_filename)` when no override is supplied.
- Writes the source PDF into the source bucket under the canonical raw object key.
- Upserts raw-layer truth in the raw asset registry before OCR processing begins.
- Repeated registration of the same source filename and identical bytes reuses the existing raw-asset record.

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
- `OCR_POLL_SECONDS`
- `OCR_TIMEOUT_SECONDS`
- `IMPORT_REPORT_DIR`
- `INGESTION_SPLIT_MANIFEST_PATH`
- `RAW_INGESTION_ARTIFACT_MODE`
- `INGESTION_EMBEDDING_MODEL`
- `INGESTION_DEFAULT_CAMPUS_SCOPE`
- `HF_HOME` / `HF_HUB_CACHE` / `TRANSFORMERS_CACHE`
- `HF_HUB_OFFLINE`

Behavior:

- Reads the source PDF from the source bucket using canonical raw-asset registry metadata.
- Does not accept local PDF paths or placeholder local job envelopes.
- Calls the async OCR provider.
- Source-bucket objects live under `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...` and are intentionally not scoped by corpus because one source asset may feed multiple corpora.
- Default `RAW_INGESTION_ARTIFACT_MODE=normalized` stores source-level `provider-response.jsonl` and `layout-elements.jsonl`, persists canonical source truth, then fans out into declared downstream projections that may write per-document `canonical.md` and `document-units.jsonl`.
- Normalized and `source_truth_only` modes both keep source artifacts under the same canonical source prefix, split by `capture/`, `provider/`, and `source-truth/` stages in the source bucket.
- Normalized mode writes derived document artifacts under `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/`.
- `RAW_INGESTION_ARTIFACT_MODE=source_truth_only` stores asset-level `provider-response.jsonl` and `layout-elements.jsonl`, but skips `canonical.md` / `document-units.jsonl` and document-registry writes.
- `source_truth_only` still writes canonical raw-asset provenance and should use the configured canonical raw-asset registry backend.
- Runtime-profile gating decides whether the selected `corpus + collection` accepts `normalized` or `source_truth_only`.
- `curriculum/curriculum_plan` may use `source_truth_only` as a pre-split onboarding path to inspect real OCR output before freezing its split manifest.
- For `regulations/student_handbook` and `curriculum/curriculum_plan`, normalized mode requires a split manifest and stores asset-level `provider-response.jsonl` / `layout-elements.jsonl` plus per-document `document-units.jsonl`; handbook also exports `canonical.md`.
- `regulations/student_handbook` normalized mode rebuilds logical documents strictly from the repo-tracked split manifest; no legacy OCR-import adapter or non-`provider-response.jsonl` handbook input is supported.
- `regulations/student_handbook` downstream fan-out is declared in `configs/ingestion/regulations/student_handbook/source-projections.v1.json`.
- When canonical source truth for the same source asset already exists, later collection work, handbook-derived service outputs, and attachment-derived outputs must rebuild from source truth through declared projections; do not return to the original PDF.
- Attachment-bearing, appendix-bearing, form-like, and navigation-like handbook leaves may materialize as explicit derived documents when they have standalone downstream value.
- Handbook retrieval preparation stays ingestion-owned: persisted `document-units.jsonl` feeds chunk generation in `packages/ingestion-core`, and `index_chunks_to_qdrant()` writes the canonical online chunk/index state into Qdrant.
- `regulations/student_handbook` chunk budgeting uses the `Qwen/Qwen3-Embedding-4B` tokenizer from local Hugging Face cache only. Prefetch it explicitly with `uv run --all-packages python -m campus_ingestion_core.prefetch_tokenizer`, then keep worker/runtime/test runs on `HF_HUB_OFFLINE=1`; the ingestion code no longer falls back to implicit network download.
- Only normalized mode registers derived document results in the document registry with `import_source=raw_online_ocr`.
- Normalized document-registry writes persist the scope cleaning policy version for traceability.
- Current OCR ingestion defaults to `revision_track=source-faithful`, `source_channel=pdf_ocr`, `is_current=false`.

### `rebuild_local_data`

Corpus-scoped rebuild shell for MinIO + registry.

Required CLI args:

- `--mode`
- `--corpus`
- `--collection`

Mode-specific CLI args:

- `provider_response_replay` requires `--raw-version-id`
- `provider_response_replay` can additionally accept `--raw-asset-id` and `--source-pdf`

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

Behavior:

- `raw_online_ocr` deletes only the selected derived scope prefix and the source artifacts explicitly selected by registry identity.
- `raw_online_ocr` deletes only the selected scope records from the document/raw-asset registry.
- Dispatches to `process_raw_ingestion_job` when `--mode raw_online_ocr`.
- Dispatches to source-truth replay rebuild when `--mode provider_response_replay`.
- `provider_response_replay` preserves source-bucket provenance and raw-asset registry provenance.
- `provider_response_replay` 只接受 typed request identity 与 repo-tracked collection truth，核心输入是 `raw_version_id`。
- `provider_response_replay` reads an existing object-store `provider-response.jsonl`, rewrites asset-level `layout-elements.jsonl`, rebuilds persisted source truth, and re-emits declared projections such as per-document `canonical.md` / `document-units.jsonl` without synthesizing raw-layer records.
- handbook replay默认 `--source-pdf 学生手册_2018.pdf`。
- `provider_response_replay` does not index Qdrant by default; add `--index-qdrant` when replay should also rebuild chunk/embedding/vector state.
- `--reset-qdrant` and `--index-qdrant` are independent: reset only clears the alias family, while replay indexing is opt-in.
- `--publish-alias` / `--no-publish-alias` control whether a successful index release should switch the serving alias after validation.
- Rebuild / replay now resolve `qdrant_alias_name` and `qdrant_collection_prefix` from each collection runtime profile instead of any global collection-name env.
- `provider_response_replay` is the canonical rebuild boundary for downstream fan-out; later projection work must not create handbook-only replay branches or separate raw re-consumption lanes.

### `release_index`

Operator-facing release shell for one `provider_response_replay -> chunking -> embedding -> indexing -> optional alias publish` run.

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
- Writes release manifests under `{corpus}/releases/{collection}/{release_id}/...`.
- Only switches the serving alias when `--publish-alias` is enabled.
- Never writes chunk dumps back to object storage.

### Source-Truth Fan-Out Rule

Phase 03.2 freezes the worker/runtime direction as:

`single source consumption + multi-projection fan-out`

Meaning:

- one raw asset is consumed once into canonical source truth
- one replay boundary is persisted once across the source/derived boundary
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

Worker shell for the handbook source-faithful migration.

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

Behavior:

- Renames the handbook raw PDF object and raw-asset registry record to the canonical filename.
- Preserves asset-level `provider-response.jsonl`.
- Clears old handbook derived artifacts and rebuilds `layout-elements.jsonl`, `canonical.md`, and `document-units.jsonl` under `regulations/documents/student_handbook/{title_slug}--{docid8}/{revision_track}/{year}/...`.
- Refreshes document-registry rows via `provider_response_replay`.
- Raw version identity is now passed as typed request input; repo-tracked collection truth resolves the split manifest by default, and `INGESTION_SPLIT_MANIFEST_PATH` remains only as an explicit override.

Example:

```bash
python -m campus_ingestion_worker.migrate_student_handbook_source_faithful --raw-version-id sha256:...
```

### `validate_student_handbook_chunking`

Read-only validation shell for the real `regulations/student_handbook` chunking inputs and outputs.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `DOCUMENT_REGISTRY_DATABASE_URL`

Optional env:

- `OBJECT_STORE_BUCKET_DERIVED`
- `INGESTION_SPLIT_MANIFEST_PATH`

Behavior:

- Loads the repo-tracked handbook split manifest, or `INGESTION_SPLIT_MANIFEST_PATH` when explicitly provided.
- Reads `regulations/student_handbook` records from the document registry and selects the current `source-faithful` version per document.
- Verifies `document-units.jsonl` exists in the derived bucket and can be converted into indexable chunks without running embeddings.
- Reports manifest/registry drift, stale registry entries, read failures, chunk-build failures, non-table oversize chunks, and structure-first eligibility statistics.
- Does not write MinIO, registry, or Qdrant state.

- Imports active `service_portal` documents into `campus_services/service_catalog`.
- Imports `中央民族大学校内常用电话` into `campus_services/contact_directory`.
- Derives handbook navigation pages declared in
  `configs/ingestion/campus_services/service_catalog/handbook-derived-documents.json`
  from `regulations/student_handbook` source-level OCR truth into `service_catalog`.
- This command is a historical backfill bridge, not a canonical current ingestion path.
- The canonical declaration of handbook downstream projections lives under
  `configs/ingestion/regulations/student_handbook/source-projections.v1.json`.
- For handbook-derived `campus_services` outputs, source-truth selector fields
  (`source_title`, `source_handbook_section`, `source_page_start`, `source_page_end`)
  are now the canonical match contract; do not require retained
  `regulations/student_handbook` manifest document ids for pages already removed from
  the handbook split manifest.
- New downstream outputs must be added to source-truth fan-out, not to this bridge.
- Rewrites migrated canonical metadata into `campus_services` corpus semantics.
- Deletes stale `regulations/student_handbook` phone-directory and migrated handbook
  navigation document artifacts.
- Only writes derived-bucket `canonical.md` artifacts and targeted cleanup.
- Does not touch registry, Qdrant, retrieval routing, or default query scopes.
