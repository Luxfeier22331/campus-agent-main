---
doc_type: state
status: completed
created: 2026-04-30
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Canonical Retrieval Release Hardening

## Current Status

**Status:** completed
**Current Phase:** Phase 9 `Post-Review Release-Quality Closeout`
**Last Activity:** 2026-05-01 post-review release-quality closeout completed

- status: `completed`
- current slice: Workstream closed after Phase 9 post-review closeout
- owner: current Codex session
- active implementation: none
- latest completed phase: Phase 9 `Post-Review Release-Quality Closeout`
- next phase: none
- status note: `gsd-sdk workstream.status` reports any phase directory with `PLAN.md` and no
  `SUMMARY.md` as `in_progress`; ROADMAP `Status:` lines remain the human execution truth for
  planned-but-not-started phases in this workstream.

## Captured Context

2026-05-01 post-review closeout context:

- `docs/architecture/system/data-plane-architecture.md` freezes the canonical chain as
  `raw asset -> provider output -> source truth -> declared projections -> canonical
  document artifacts -> document-units -> chunks -> index`.
- Existing implementation already has chunk preparation manifest, release manifest,
  dense+sparse Qdrant indexing, Qdrant alias publish, metadata/authz filters, RRF
  retrieval, release id hardening, and provider replay no-alias boundary.
- Phase 0 evidence is captured at
  `evidence/phase-00-current-inventory.md`.
- Gaps closed in Phase 9:
  - Chunk quality audit is now a query-serving release blocking gate, with
    `quality-gate-summary.json` release artifact evidence.
  - Release manifest / point payload now carries quality gate status, chunk quality status,
    qrels coverage status, and release metadata consistency status.
  - Runtime drift guard samples collection metadata / multiple point payloads and fail-closes
    mixed release/profile metadata.
  - Runtime drift guard cache is keyed by collection plus profile identity, so profile changes
    invalidate old guard results.
  - Query embedding cache key includes provider/model/dimension and collection/profile
    identity, not only normalized query text.
  - Default query-enabled qrels coverage now requires declared scenario denominator entries,
    not only class/count coverage.
  - Retrieval monitoring can load sanitized runtime observation JSONL and emit deterministic
    backlog JSON.

## Blockers

- No external blocker.
- Phase 2 created and requires a small deterministic acceptance fixture set before any
  query-serving alias publish can pass; missing fixtures fail closed.
- Phase 5 runtime drift guard posture is frozen: online query path uses Qdrant point payload /
  current release metadata; object-store manifest is audit / offline fallback only.
- Phase 6/9 embedding cache uses deterministic provider/model/dimension/profile identity;
  cache key changes must invalidate stale vectors.

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

Phase 8 focused gate result:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_embed \
  tests.ingestion.test_corpus_runtime_profile \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_index_release \
  tests.ingestion.test_qdrant_backup \
  tests.ingestion.test_qdrant_backup_worker \
  tests.retrieval.test_backend_qdrant \
  tests.retrieval.test_service \
  tests.evals.test_retrieval_benchmark \
  tests.evals.test_retrieval_tuning
```

Result: `Ran 288 tests ... OK`.

Phase 9 focused gate result:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_embed \
  tests.ingestion.test_corpus_runtime_profile \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_index_release \
  tests.ingestion.test_qdrant_backup \
  tests.ingestion.test_qdrant_backup_worker \
  tests.retrieval.test_backend_qdrant \
  tests.retrieval.test_service \
  tests.evals.test_retrieval_benchmark \
  tests.evals.test_retrieval_tuning
```

Result: `Ran 296 tests ... OK`.

Docs gate:

```bash
pnpm docs:lint
```

Result: `Summary: 0 error(s)`.

## Continuity Notes

- Do not publish query-serving alias from provider-response replay.
- Do not make retrieval-core own product admission; it may enforce runtime safety only after
  supervisor/rag-agent admission selects a scope.
- Do not put object bytes in Postgres; release artifacts stay in S3-compatible object storage.
- Do not use eval tuning to silently expand query-enabled scopes.
- Do not let missing release acceptance fixtures count as a passed query-serving publish gate.

## Reopen Rule

Reopen only if one of these happens:

- a query-enabled scope is added without qrels / release acceptance coverage
- release manifest / point payload provenance drifts from runtime profile fields
- runtime drift guard fails to catch a release/profile mismatch
- embedding cache changes provider/model/dimension identity without invalidating cache keys
- retrieval tuning starts mutating production profiles without deterministic passing evidence
