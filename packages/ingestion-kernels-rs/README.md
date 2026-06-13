# ingestion-kernels-rs

Deterministic file-level kernels for ingestion/data-plane proof work.

Current kernel:

- `validate_document_units_jsonl`

Boundary:

- no Postgres
- no Qdrant
- no object-store client
- no provider calls
- no source-channel business semantics

Kernels receive already materialized file content and return deterministic
reports. Promotion into the default ingestion path requires output equivalence
and profiling evidence.
