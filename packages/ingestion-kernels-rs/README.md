# ingestion-kernels-rs

Deterministic high-performance kernels for ingestion/data-plane work.

This package is the long-term Rust execution substrate for CPU-heavy,
deterministic ingestion tasks. It is not a deployable service and does not own
runtime orchestration.

Current kernels:

- `validate-document-units`: validate canonical document-unit JSONL.
- `chunk-document-units`: prepare token-budgeted chunks from canonical
  document-unit JSONL.
- `validate-release-manifest`: validate release manifest shape plus digest and
  duplicate-artifact consistency.

CLI runner:

```bash
cargo run -p ingestion-kernels-rs --bin ingestion-kernel-runner -- \
  validate-document-units < document-units.jsonl
cargo run -p ingestion-kernels-rs --bin ingestion-kernel-runner -- \
  chunk-document-units \
  --tokenizer-json /models/qwen3/tokenizer.json \
  --chunk-size 384 \
  --max-tokens 512 \
  --min-tokens 96 \
  --overlap 64 < document-units.jsonl
cargo run -p ingestion-kernels-rs --bin ingestion-kernel-runner -- \
  validate-release-manifest < release-manifest.json
```

Implementation rules:

- JSON / JSONL validation uses `jsonschema` rather than hand-written field
  checks.
- canonical document units use the shared `canonical_document_units.v1` shape
  from `packages/ingestion-contracts`: input identity is `doc_id` + `chunk_id`,
  and chunk output uses `doc_id`, not legacy `document_id`.
- release manifest validation uses the shared `ingestion_release_manifest.v1`
  schema from `packages/ingestion-contracts`; Rust only adds deterministic
  digest and duplicate-artifact consistency checks.
- chunk budgeting uses a local Hugging Face `tokenizer.json` through
  `tokenizers` / `text-splitter`; kernels must not download tokenizer assets.
- `--max-chars` is retired and must not be used for chunk budgeting.
- Runtime collection profile parsing stays in TypeScript. Rust kernels receive
  resolved CLI parameters only.

Boundary:

- no Postgres
- no Qdrant
- no object-store client
- no provider calls
- no source-channel business semantics

Kernels receive already materialized file content and return deterministic
reports through stdout. `apps/ingestion-control` owns the object-store bridge,
task closeout and fail-closed runtime dispatch.
