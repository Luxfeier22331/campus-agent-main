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

### `process_raw_ingestion_job`

Worker shell for the production raw-first path.

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

Behavior:

- Reads the source PDF from the raw bucket using canonical raw-asset registry metadata.
- Does not accept local PDF paths or placeholder local job envelopes.
- Calls the async OCR provider.
- Raw objects live under `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...` and are intentionally not scoped by corpus because one raw asset may feed multiple corpora.
- Default `RAW_INGESTION_ARTIFACT_MODE=normalized` stores asset-level `provider-response.jsonl` and `layout-elements.jsonl`, then writes per-document `canonical.md` and `document-units.jsonl`.
- Normalized and provider-only modes both keep processed source artifacts under `{corpus}/sources/{source_channel}/{source_asset_slug}/{year}/{ingest_id}/...`.
- Normalized mode writes processed document artifacts under `{corpus}/documents/{collection}/{title_slug}--{docid8}/{representation}/{year}/`.
- `RAW_INGESTION_ARTIFACT_MODE=provider_only` stores asset-level `provider-response.jsonl` only, and skips `canonical.md` / `document-units.jsonl` and document-registry writes.
- `provider_only` still writes canonical raw-asset provenance and should use the configured canonical raw-asset registry backend.
- Runtime-profile gating decides whether the selected `corpus + collection` accepts `normalized` or `provider_only`.
- `curriculum/curriculum_plan` may use `provider_only` as a pre-split onboarding path to inspect real OCR output before freezing its split manifest.
- For `INGESTION_CORPUS=regulations` + `INGESTION_COLLECTION=student_handbook` and `INGESTION_CORPUS=curriculum` + `INGESTION_COLLECTION=curriculum_plan`, normalized mode requires a split manifest and stores asset-level `provider-response.jsonl` / `layout-elements.jsonl` plus per-document `document-units.jsonl`; handbook also exports `canonical.md`.
- `regulations/student_handbook` normalized mode rebuilds logical documents strictly from the repo-tracked split manifest; no legacy OCR-import adapter or non-`provider-response.jsonl` handbook input is supported.
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
- Dispatches to handbook replay rebuild when `REBUILD_IMPORT_MODE=provider_response_replay`.
- `provider_response_replay` preserves raw bucket provenance and raw-asset registry provenance.
- `provider_response_replay` reads an existing object-store `provider-response.jsonl`, rewrites asset-level `layout-elements.jsonl`, rewrites per-document `canonical.md` / `document-units.jsonl`, and refreshes document registry without synthesizing raw-layer records.
- handbook replay默认 `REPLAY_SOURCE_PDF=学生手册_2018.pdf`；兼容 `student-handbook.pdf` 仅用于迁移。
- `provider_response_replay` does not index Qdrant by default; set `REBUILD_INDEX_QDRANT=1` when replay should also rebuild chunk/embedding/vector state.
- `REBUILD_RESET_QDRANT` and `REBUILD_INDEX_QDRANT` are independent: reset only clears the collection, while replay indexing is opt-in.

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
