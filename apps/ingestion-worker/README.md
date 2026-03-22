# campus-ingestion-worker

Runtime shell for campus-agent v2 ingestion commands.

## Commands

`apps/ingestion-worker` exposes three phase-1 runtime shells for `student_handbook`.

### `import_campusrag_existing_ocr`

Legacy backfill tool for existing campusRAG structured OCR assets.

Required env:

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `CAMPUSRAG_OCR_ROOT`

Optional env:

- `CAMPUSRAG_RAW_ROOT`
- `DOCUMENT_REGISTRY_PATH`
- `IMPORT_REPORT_DIR`
- `INGESTION_EMBEDDING_MODEL`
- `DEFAULT_CAMPUS_SCOPE`

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

- `CAMPUSRAG_RAW_ROOT`

Optional env:

- `RAW_INGESTION_JOB_DIR`
- `IMPORT_REPORT_DIR`

Behavior:

- Enumerates PDFs under `CAMPUSRAG_RAW_ROOT`.
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
- `OCR_BASE_URL`
- `OCR_API_KEY`
- One of:
  `CAMPUSRAG_RAW_ROOT` or `RAW_INGESTION_JOB_PATH`

Optional env:

- `OCR_MODEL`
- `OCR_POLL_SECONDS`
- `OCR_TIMEOUT_SECONDS`
- `DOCUMENT_REGISTRY_PATH`
- `IMPORT_REPORT_DIR`
- `RAW_INGESTION_JOB_PATH`
- `INGESTION_EMBEDDING_MODEL`
- `DEFAULT_CAMPUS_SCOPE`

Behavior:

- Reads raw PDFs either directly from `CAMPUSRAG_RAW_ROOT` or from a placeholder job envelope.
- Uploads raw PDFs into the raw bucket.
- Calls the async OCR provider.
- Stores `provider-result.jsonl` and `structured.jsonl` separately in the processed bucket.
- Registers processed results in the document registry with `import_source=raw_online_ocr`.

Example:

```bash
python -m campus_ingestion_worker.process_raw_ingestion_job
```
