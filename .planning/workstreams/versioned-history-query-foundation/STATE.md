---
workstream: versioned-history-query-foundation
created: 2026-04-21
updated: 2026-04-21
---

# Project State

## Current Position
**Status:** Completed
**Current Phase:** Complete
**Current Phase Name:** Closed Out After Phase 5
**Current Plan:** `<none>`
**Total Phases:** 5
**Total Plans in Phase:** 0
**Progress:** 5/5 phases complete
**Last Activity:** 2026-04-21
**Last Activity Description:** Completed `Phase 5` by adding typed version-aware eval cases, versioned semantic metrics, fail-close regression for unresolved/incomplete compare support, and explicit app-api eval-client fail-fast on non-current cases.

## Current Slice

- completed `Phase 1` artifacts:
  - context: `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/CONTEXT.md`
  - research: `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/RESEARCH.md`
  - plan: `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/PLAN.md`
  - summary: `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/SUMMARY.md`
- completed `Phase 2` artifacts:
  - context: `.planning/workstreams/versioned-history-query-foundation/phases/phase-2-registry-version-resolution/CONTEXT.md`
  - research: `.planning/workstreams/versioned-history-query-foundation/phases/phase-2-registry-version-resolution/RESEARCH.md`
  - plan: `.planning/workstreams/versioned-history-query-foundation/phases/phase-2-registry-version-resolution/PLAN.md`
  - summary: `.planning/workstreams/versioned-history-query-foundation/phases/phase-2-registry-version-resolution/SUMMARY.md`
- completed `Phase 3` artifacts:
  - context: `.planning/workstreams/versioned-history-query-foundation/phases/phase-3-retrieval-version-filter/CONTEXT.md`
  - research: `.planning/workstreams/versioned-history-query-foundation/phases/phase-3-retrieval-version-filter/RESEARCH.md`
  - plan: `.planning/workstreams/versioned-history-query-foundation/phases/phase-3-retrieval-version-filter/PLAN.md`
  - summary: `.planning/workstreams/versioned-history-query-foundation/phases/phase-3-retrieval-version-filter/SUMMARY.md`
- completed `Phase 4` artifacts:
  - context: `.planning/workstreams/versioned-history-query-foundation/phases/phase-4-specialist-answer-semantics/CONTEXT.md`
  - research: `.planning/workstreams/versioned-history-query-foundation/phases/phase-4-specialist-answer-semantics/RESEARCH.md`
  - plan: `.planning/workstreams/versioned-history-query-foundation/phases/phase-4-specialist-answer-semantics/PLAN.md`
  - summary: `.planning/workstreams/versioned-history-query-foundation/phases/phase-4-specialist-answer-semantics/SUMMARY.md`
- completed `Phase 5` artifacts:
  - context: `.planning/workstreams/versioned-history-query-foundation/phases/phase-5-eval-coverage/CONTEXT.md`
  - research: `.planning/workstreams/versioned-history-query-foundation/phases/phase-5-eval-coverage/RESEARCH.md`
  - plan: `.planning/workstreams/versioned-history-query-foundation/phases/phase-5-eval-coverage/PLAN.md`
  - summary: `.planning/workstreams/versioned-history-query-foundation/phases/phase-5-eval-coverage/SUMMARY.md`

- 新激活的 versioned history query workstream 只处理：
  - explicit version query mode
  - registry version resolution
  - retrieval version filter
  - `rag-agent` 历史/对比回答语义
  - eval coverage
- 当前问题收口为：
  - `current / historical / as_of / compare` 如何进入 query path 的正式 protocol
  - 没有显式 version mode 的旧请求如何继续保持默认 `current`
  - version selection 如何在 retrieval 前显式化，而不是留给 backend 或 prompt 猜测
  - 这条线如何与 `freshness_sensitive / live_assisted` 分层
- 已完成的 `Phase 1` 收口：
  - request protocol mode 闭集已固定为 `current / historical / as_of / compare`
  - `SupervisorRequest` 与 `RagRequestPayload` 已拥有 typed `version_query`
  - 没有显式 mode 的旧请求继续默认 `current`
  - `place_lookup` 等非 knowledge 路径不会误收历史版本 mode
- `Phase 5` 已完成收口：
  - `GoldenCase` 现在可以显式携带 typed `version_query`
  - 新增 `versioned_history_regression_locked_cases()` 覆盖 `current / historical / as_of / compare`
  - `version_filter_unresolved` 与 `compare_support_incomplete` 已进入 deterministic fail-close regression
  - `historical_grounded_answer / as_of_grounded_answer / compare_grounded_answer` 已进入正式 semantic metric
  - `app-api` eval client 对 non-current case 会显式 fail-fast，而不是静默 current-only downgrade

## Blockers

- 无；这条 workstream 已完成。
- 后续如需让 app-api live benchmark 真正承载 non-current `version_query`，应在新的 runtime-specific workstream 内补产品 route contract，而不是在本线继续扩写。

## Verification

- `Phase 1` 已实现 typed request protocol code
- `Phase 2` 已实现 registry version resolution code 与 summary：
  - `.planning/workstreams/versioned-history-query-foundation/phases/phase-2-registry-version-resolution/SUMMARY.md`
- `Phase 3` 已实现 retrieval version filter code 与 summary：
  - `.planning/workstreams/versioned-history-query-foundation/phases/phase-3-retrieval-version-filter/SUMMARY.md`
- `Phase 4` 已实现 specialist answer semantics code 与 summary：
  - `.planning/workstreams/versioned-history-query-foundation/phases/phase-4-specialist-answer-semantics/SUMMARY.md`
- `Phase 5` 已实现 eval coverage code 与 summary：
  - `.planning/workstreams/versioned-history-query-foundation/phases/phase-5-eval-coverage/SUMMARY.md`
- targeted verification:
  - `uv run --all-packages python -m unittest tests.contracts.test_models tests.api.test_supervisor_api tests.supervisor.test_supervisor_core tests.ingestion.test_version_resolution`
  - `uv run --all-packages python -m unittest tests.retrieval.test_service tests.retrieval.test_backend_qdrant tests.specialist.test_rag_specialist`
  - `uv run --all-packages python -m unittest tests.contracts.test_models tests.api.test_supervisor_api tests.supervisor.test_supervisor_core tests.ingestion.test_version_resolution tests.retrieval.test_service tests.retrieval.test_backend_qdrant tests.specialist.test_rag_specialist`
  - `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist`
  - `uv run --all-packages python -m unittest tests.ingestion.test_version_resolution tests.retrieval.test_service tests.retrieval.test_backend_qdrant tests.specialist.test_rag_specialist`
  - `uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_handbook_live_benchmark tests.evals.test_curriculum_live_benchmark`

## Session Continuity

**Stopped At:** workstream 已在 `Phase 5` 收口完成；如需继续推进，应新开 runtime-specific follow-up，而不是在这条已完成 workstream 上追加 phase
**Resume File:** `<none>`
