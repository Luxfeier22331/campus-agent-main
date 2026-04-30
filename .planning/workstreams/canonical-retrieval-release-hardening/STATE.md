---
doc_type: state
status: active
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# State: Canonical Retrieval Release Hardening

## Current Status

- status: `active`
- current slice: planning complete; Phase 0 ready to start
- owner: current Codex session
- active implementation: none yet
- next phase: Phase 0 `Scope And Truth Alignment`

## Captured Context

2026-04-30 review context:

- `docs/architecture/system/data-plane-architecture.md` freezes the canonical chain as
  `raw asset -> provider output -> source truth -> declared projections -> canonical
  document artifacts -> document-units -> chunks -> index`.
- Existing implementation already has chunk preparation manifest, release manifest,
  dense+sparse Qdrant indexing, Qdrant alias publish, metadata/authz filters, RRF
  retrieval, release id hardening, and provider replay no-alias boundary.
- Current gaps:
  - query-enabled truth is inconsistent across docs/runtime config/policy.
  - release validation does not yet run retrieval acceptance before alias publish.
  - retrieval runtime does not yet compare current settings/profile against alias release
    manifest.
  - sparse/hybrid provenance is not fully captured.
  - tokenizer/chunker implementation provenance is not fully captured.
  - embedding cache is not implemented.
  - retrieval tuning is not yet qrels-driven per collection.

## Blockers

- No external blocker for Phase 0.
- Phase 2 needs a small deterministic qrels fixture set per opened collection.
- Phase 3 needs object-store access posture for retrieval runtime manifest loading, or an
  accepted alternative using indexed point metadata only.
- Phase 6 needs cache storage decision: object store only, Postgres metadata pointer, or both.

## Verification Plan

Baseline commands for this workstream:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_embed \
  tests.ingestion.test_corpus_runtime_profile \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_index_release \
  tests.ingestion.test_qdrant_backup \
  tests.ingestion.test_qdrant_backup_worker \
  tests.ingestion.provider_result_replay_rebuild_index_suite \
  tests.ingestion.provider_result_replay_rebuild_replay_indexing_suite \
  tests.ingestion.provider_result_replay_rebuild_replay_failure_suite \
  tests.ingestion.rebuild_local_data_runtime_suite \
  tests.ingestion.rebuild_local_data_replay_suite \
  tests.ingestion.test_rebuild_local_data_worker \
  tests.ingestion.test_release_index_worker \
  tests.ingestion.test_internal_notice_scope_chunk_pipeline \
  tests.ingestion.test_regulation_serving_release_gates \
  tests.retrieval.test_backend_qdrant \
  tests.retrieval.test_service
```

Standard lint/docs checks:

```bash
uv run --all-packages ruff check <touched-python-files>
uv run --all-packages ruff format <touched-python-files> --check
pnpm docs:lint
```

Repo-wide unittest is currently not clean in this dirty worktree due unrelated supervisor bridge,
protected-panel import, curriculum multimodal probe, public-docs missing file, and process-smoke
failures. Use focused gates for this workstream and report repo-wide residual failures separately.

## Continuity Notes

- Do not publish query-serving alias from provider-response replay.
- Do not make retrieval-core own product admission; it may enforce runtime safety only after
  supervisor/rag-agent admission selects a scope.
- Do not put object bytes in Postgres; release artifacts stay in S3-compatible object storage.
- Do not use eval tuning to silently expand query-enabled scopes.
