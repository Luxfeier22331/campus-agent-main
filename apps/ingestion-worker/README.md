# campus-ingestion-worker

Runtime shell for campus-agent v2 ingestion commands.

## Commands

`apps/ingestion-worker` exposes phase-1 ingestion shells.

- Query-facing default corpus remains `student_handbook`.
- Data-plane ingestion supports `student_handbook` and `curriculum_plan`.

### `import_campusrag_existing_ocr`

Legacy backfill tool for existing campusRAG structured OCR assets.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `DOCUMENT_REGISTRY_DATABASE_URL`
- `CAMPUSRAG_OCR_ROOT`

Optional env:

- `CAMPUSRAG_RAW_ROOT`
- `IMPORT_REPORT_DIR`
- `INGESTION_EMBEDDING_MODEL`
- `INGESTION_DEFAULT_CAMPUS_SCOPE`

Behavior:

- Reads structured OCR JSONL from `CAMPUSRAG_OCR_ROOT`.
- If `CAMPUSRAG_RAW_ROOT` is set, it only binds raw provenance and uploads shared raw PDFs.
- If `CAMPUSRAG_RAW_ROOT` is set, every structured record must
  resolve to a raw PDF under object storage; unresolved raw sources fail the import.

Example:

```bash
python -m campus_ingestion_worker.import_campusrag_existing_ocr
```

### `submit_raw_ingestion_job`

Queue placeholder shell for the future production raw-first path.

Required env:

- One of `CAMPUSRAG_RAW_ROOT` or `RAW_INGESTION_SOURCE_PATHS`

Optional env:

- `RAW_INGESTION_JOB_DIR`
- `IMPORT_REPORT_DIR`
- `INGESTION_CORPUS`

Behavior:

- Enumerates PDFs under `CAMPUSRAG_RAW_ROOT` or uses the explicit list in `RAW_INGESTION_SOURCE_PATHS`.
- Writes a placeholder job envelope to `RAW_INGESTION_JOB_DIR`.
- Does not upload or OCR files by itself.

Example:

```bash
python -m campus_ingestion_worker.submit_raw_ingestion_job
```

### `process_raw_ingestion_job`

Worker shell for the production raw-first path.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `DOCUMENT_REGISTRY_DATABASE_URL`
- `OCR_BASE_URL`
- `OCR_API_KEY`
- One of:
  `CAMPUSRAG_RAW_ROOT`, `RAW_INGESTION_JOB_PATH`, or `RAW_INGESTION_SOURCE_PATHS`

Optional env:

- `OCR_MODEL`
- `OCR_POLL_SECONDS`
- `OCR_TIMEOUT_SECONDS`
- `IMPORT_REPORT_DIR`
- `RAW_INGESTION_JOB_PATH`
- `RAW_INGESTION_SOURCE_PATHS`
- `INGESTION_CORPUS`
- `INGESTION_SPLIT_MANIFEST_PATH`
- `INGESTION_EMBEDDING_MODEL`
- `INGESTION_DEFAULT_CAMPUS_SCOPE`

Behavior:

- Reads raw PDFs either directly from `CAMPUSRAG_RAW_ROOT` or from a placeholder job envelope.
- `RAW_INGESTION_SOURCE_PATHS` takes precedence when set.
- Uploads raw PDFs into the raw bucket.
- Calls the async OCR provider.
- Stores `provider-result.jsonl` and `structured.jsonl` separately in the processed bucket.
- When `INGESTION_CORPUS=curriculum_plan`, requires a split manifest and stores asset-level `provider-result.jsonl` / `structured-full.jsonl` plus per-document `structured.jsonl`.
- Registers processed results in the document registry with `import_source=raw_online_ocr`.

### `rebuild_local_data`

Corpus-scoped rebuild shell for MinIO + registry.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `REBUILD_IMPORT_MODE`

Optional env:

- `INGESTION_CORPUS`
- `DOCUMENT_REGISTRY_DATABASE_URL`
- `DOCUMENT_REGISTRY_PATH`
- `RAW_ASSET_REGISTRY_PATH`
- `REBUILD_RESET_QDRANT`
- Any env required by the selected import mode

Behavior:

- Deletes only the selected corpus prefix from raw/processed buckets.
- Deletes only the selected corpus records from the document/raw-asset registry.
- Dispatches to `import_campusrag_existing_ocr` when `REBUILD_IMPORT_MODE=existing_ocr`.
- Dispatches to `process_raw_ingestion_job` when `REBUILD_IMPORT_MODE=raw_online_ocr`.

Example:

```bash
python -m campus_ingestion_worker.process_raw_ingestion_job
```
