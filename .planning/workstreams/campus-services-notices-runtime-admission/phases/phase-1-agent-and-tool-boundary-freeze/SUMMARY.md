---
phase: "1"
name: "Agent And Tool Boundary Freeze"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 1 Summary

## What Closed

- 冻结了这条 runtime-admission lane 的首条 capability boundary：`supervisor` 只负责 routing / terminal semantics，`campus-services-agent`、`notice-agent`、`navigation-agent`、`rag-specialist` 的职责边界不再继续漂移。
- 固定首发 tool surface 为闭集：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- 固定 current-truth `*-specialist` label 与 target-side `*-agent` family label 的短期并存规则；本线只冻结 mapping，不执行 repo-wide rename。
- 固定 `campus_notice_discover/get` 的 source matrix 必须显式区分：
  - public `official_web` notice-like pages
  - restricted `campus_notices/internal_notice`
- 固定 `current/latest/effective/current-year miss` 为 code-owned semantics：
  - 当前状态不可证时，`service_status_lookup` / `transport_schedule_lookup` 必须 fail-close
  - `campus_notice_discover` 在 current-year miss 时只允许 explicit historical downgrade，不得把往年通知冒充成当前结果

## Fresh Evidence

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_query_policy tests.specialist.test_availability_specialist tests.specialist.test_navigation_specialist`
- `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist.RagSpecialistTest.test_official_web_no_evidence_uses_scope_specific_no_answer_copy tests.specialist.test_rag_specialist.RagSpecialistTest.test_official_web_freshness_sensitive_query_uses_scope_specific_fail_close_copy`

## Handoff

- `Phase 1` 现已正式 completed。
- 下一阶段固定进入 `Phase 2: Tool Contract Freeze`。
- `Phase 2` 只负责为首发 `4` 个 tool 冻结 shared payload/result schema、status enum、temporal semantics、historical downgrade 与 fail-close output shape，不提前跳到 query service 或 runtime wiring。
