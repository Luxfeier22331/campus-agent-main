---
phase: "5"
name: "Verification And Opening Gate"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 5 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结首发 `4` 个 tool 的 verification / observability / opening gate truth
- 明确哪些 evidence 是 opening 前置条件
- 明确 fail-close、historical downgrade、stable-RAG boundary 的 release gate 口径
- 明确 operator/read-model 需要看到的最小 runtime summary

它不负责：

- 打开 query-serving surface
- 绕过 backing query implementation 缺口直接宣布产品可用
- 重开 `Phase 1-4` 的 owner / contract / query service interface 边界
- later-wave `contact_directory_lookup` / `service_process_lookup`

</domain>

<current_truth>
## Current Truth

- `Phase 4` 已完成：
  - forward runtime owner package：`campus-services-agent` / `notice-agent`
  - internal query service protocol
  - thin tool adapter
  - default supervisor delegate wiring
  - per-agent `allowed_tools` enforcement
- 当前仍未完成：
  - projection-backed backing query implementation
  - 产品主路径自然 routing 到这些 runtime agent
  - opening gate / eval / observability closeout
- `app-api -> supervisor-api` execution seam 仍保持稳定；当前没有新增 browser-visible contract
- `Phase 3` 已冻结：
  - `service_status_lookup` / `transport_schedule_lookup` 只能读 projection-backed structured truth
  - `campus_notice_discover/get` 继续区分 public notice family 与 restricted notice family
  - internal query service 不得回扫 raw/source bundle 或 loopback `app-api`

</current_truth>

<decisions>
## Planning Decisions

- **05-01:** opening gate 必须建立在 repo-owned runtime evidence 上，而不是“代码看起来已经接好了”。
- **05-02:** `Phase 5` 的验证对象至少包括：
  - service status fail-close
  - transport schedule fail-close
  - notice discover current-year miss -> explicit historical reference
  - stable制度/流程问题继续留在 `rag-specialist`
- **05-03:** operator-facing observability 继续由 `app-api` read model 拥有；`supervisor-api` / specialist package 不直接变成 panel query backend。
- **05-04:** opening gate 只读取 typed summary seam，不读取 raw tool adapter internals、raw prompt、raw query payload 或 raw source bundle。
- **05-05:** 如果 backing query implementation 仍未 ready，opening gate 必须显式保持 closed，而不是以 stub / unavailable path 假装“已经支持但暂时不稳定”。

</decisions>

<specifics>
## Specific Gaps

- 还没有首发 `4` 个 tool 的 release-gate eval matrix。
- 还没有这些 tool 的 minimal observability projection truth。
- 还没有 “哪些条件满足后才允许从 fail-close 进入 opened runtime lane” 的正式 gate checklist。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-4-internal-query-service-and-supervisor-handoff-wiring/SUMMARY.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/architecture/system/prompt-and-instruction-architecture.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `packages/campus-services-agent/src/campus_services_agent/query_service.py`
- `packages/notice-agent/src/campus_notice_agent/query_service.py`

</canonical_refs>

<deferred>
## Deferred Follow-up

- backing query implementation
- product-path routing enablement
- actual opening execution

</deferred>
