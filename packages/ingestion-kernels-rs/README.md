# ingestion-kernels-rs

Deterministic file-level kernels for ingestion/data-plane proof work.

Current kernels:

- `validate_document_units_jsonl`
- `chunk_document_units_jsonl`
- `validate_release_manifest_json`

CLI runner:

```bash
cargo run -p ingestion-kernels-rs --bin ingestion-kernel-runner -- \
  validate-document-units < document-units.jsonl
cargo run -p ingestion-kernels-rs --bin ingestion-kernel-runner -- \
  chunk-document-units --max-chars 4000 < document-units.jsonl
cargo run -p ingestion-kernels-rs --bin ingestion-kernel-runner -- \
  validate-release-manifest < release-manifest.json
```

Boundary:

- no Postgres
- no Qdrant
- no object-store client
- no provider calls
- no source-channel business semantics

Kernels receive already materialized file content and return deterministic
reports through stdout. `apps/ingestion-control` owns the object-store bridge,
task closeout and fail-closed runtime dispatch.
