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
**Current Phase:** Phase 10 `Runtime Eval Intake And Filter Audit Closeout`
**Last Activity:** 2026-05-01 runtime eval intake and filter audit closeout completed

- status: `completed`
- current slice: Workstream closed after Phase 10 runtime eval/filter audit closeout
- owner: current Codex session
- active implementation: none
- latest completed phase: Phase 10 `Runtime Eval Intake And Filter Audit Closeout`
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
- Gaps closed in Phase 10:
  - supervisor-agent-worker can inject a JSONL retrieval observation sink via
    `SUPERVISOR_RETRIEVAL_OBSERVATION_JSONL_PATH`.
  - `packages/evals` has an offline chunk quality JSON report CLI for release evidence.
  - Qdrant payload indexes used by retrieval filters are centralized and post-publish audit now
    fail-closes missing or mismatched filter indexes.
  - `packages/evals` has a deterministic rerank before/after branch for qrels-backed candidate
    evaluation before any production reranker adoption.
- 2026-05-01 repair loop follow-up:
  - payload indexes are now created before points upsert on release indexing.
  - retrieval observation sink failures warn and do not fail the online answer path.
  - chunk quality CLI returns non-zero when the generated report fails.
  - sanitized retrieval observations no longer write raw query text by default; they retain
    `query_sha256`, with raw text allowed only through an explicit operator debug switch.
  - indexed lookup backend fail-closed exceptions now emit sanitized failed observations before
    reraising, and release metadata drift is classified for monitoring backlog repair.

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

Phase 10 focused gate result:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_index_release \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_qdrant_backup \
  tests.ingestion.test_qdrant_backup_worker \
  tests.retrieval.backend_qdrant_release_guard_suite \
  tests.retrieval.backend_qdrant_client_settings_suite \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.retrieval.test_backend_qdrant \
  tests.retrieval.test_service \
  tests.evals.test_retrieval_benchmark \
  tests.evals.test_retrieval_tuning \
  tests.evals.retrieval_rerank_eval_suite \
  tests.agent.test_rag_retrieval_plan \
  tests.api.supervisor_api_settings_and_health_suite.SupervisorApiSettingsAndHealthTest.test_api_settings_from_env_reads_retrieval_observation_settings \
  tests.api.supervisor_api_settings_and_health_suite.SupervisorApiSettingsAndHealthTest.test_rag_delegate_wires_jsonl_retrieval_observation_sink_when_configured
```

Result: `Ran 342 tests ... OK`.

Targeted docs gate:

```bash
pnpm exec markdownlint-cli2 \
  docs/architecture/system/retrieval-serving-architecture.md \
  docs/runbooks/index-release-runbook.md \
  .planning/workstreams/canonical-retrieval-release-hardening/STATE.md \
  .planning/workstreams/canonical-retrieval-release-hardening/ROADMAP.md
```

Result: `Summary: 0 error(s)`.

Repo-wide `pnpm docs:lint` is currently blocked by an unrelated authenticated-notice long line in
`docs/data/authenticated-notice-source-truth-schema.md`.

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
