---
phase: "4"
name: "Internal Query Service And Supervisor Handoff Wiring"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 4 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结首发 `4` 个 tool 的 implementation direction：
  - repo-owned internal query service
  - thin tool adapter
  - `supervisor -> campus-services-agent / notice-agent` handoff
  - per-agent `allowed_tools`
  - execution ownership
- 冻结 `app-api -> supervisor-api -> supervisor-core` 在这条 lane 上的调用边界
- 为 `Phase 5` 的 verification / opening gate 提供 execution-ready wiring truth

它不负责：

- 真正实现 internal query service、tool adapter 或新的 domain-agent package
- 打开 query-serving surface
- repo-wide `*-specialist -> *-agent` rename
- later-wave `contact_directory_lookup` / `service_process_lookup`

</domain>

<current_truth>
## Current Truth

- `Phase 1` 已冻结 capability boundary、tool closed set 与 temporal semantics。
- `Phase 2` 已把四个首发 tool 的 shared contract 落进 `packages/contracts`。
- `Phase 3` 已冻结这四个 tool 的 source-truth / normalized-truth owner 与 query projection seam。
- 当前 `docs/contracts/app-api-supervisor-execution.md` 仍只显式写：
  - `requested_capability = knowledge | availability | place_lookup`
  - `app-api` 调 `supervisor-api`
  - browser 不直接使用这份 execution contract
- 当前 `packages/supervisor-core` 仍只接：
  - `rag-specialist`
  - `availability-specialist`
  - `navigation-specialist`
- `packages/supervisor-core/agent.py` 当前默认 delegate map 仍只有上述三条 current-truth delegate。
- 当前没有：
  - domain-owned tool adapter layer
  - repo-owned internal query service interface
  - code-owned per-agent `allowed_tools`
  - 针对 `campus-services-agent` / `notice-agent` 的 runtime handoff seam

</current_truth>

<decisions>
## Implementation Decisions

- **04-01:** `app-api` 继续只负责 product-layer auth/session/request projection；它不得直接调用 internal query service，也不得拥有 tool adapter。
- **04-02:** `supervisor-api` / `packages/supervisor-core` 继续只负责 execution admission、routing、handoff shaping 与 finalization；不得把 structured truth retrieval 逻辑塞回 `supervisor-core`。
- **04-03:** internal query service 必须是 repo-owned execution-side seam；不得走 browser/public API，也不得走 `app-api` loopback HTTP。
- **04-04:** tool adapter 必须是 thin adapter：
  - 输入对齐 `packages/contracts` 的 tool payload
  - 调 internal query service
  - 输出对齐 `packages/contracts` 的 tool result
  - 不在 adapter 内扫描 raw/source bundle 或重写 truth owner
- **04-05:** per-agent `allowed_tools` 必须 code-owned：
  - `campus-services-agent`
    - `service_status_lookup`
    - `transport_schedule_lookup`
  - `notice-agent`
    - `campus_notice_discover`
    - `campus_notice_get`
  - `navigation-agent`
    - 不重新拥有 timetable/service-status truth
- **04-06:** current-truth label coexistence 继续成立；本 phase 冻结 wiring 方向，不强行把所有现有 enum / package 一次性 rename。
- **04-07:** `Phase 4` 必须显式区分：
  - routing / handoff status
  - tool business outcome
  - query service failure / fail-close
  避免执行层再次把这些状态混平。

</decisions>

<specifics>
## Specific Gaps

- 还没有 internal query service 的 package-owner / interface truth。
- 还没有 tool adapter owner 与目录落点。
- 还没有 `supervisor-core` 如何把现有 current-truth delegate map 演进到 domain-agent handoff 的正式方向。
- 还没有 per-agent `allowed_tools` enforcement seam。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/REQUIREMENTS.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-3-structured-truth-admission-and-query-projection-freeze/SUMMARY.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/supervisor-core/src/campus_supervisor_core/context.py`
- `packages/supervisor-core/src/campus_supervisor_core/routing.py`
- `packages/supervisor-core/src/campus_supervisor_core/framing.py`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `packages/supervisor-core/src/campus_supervisor_core/policy.py`
- `tests/supervisor/test_supervisor_core.py`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 5`: verification / opening gate
- actual internal query service implementation
- actual tool adapter implementation
- actual domain-agent package introduction
- repo-wide label migration

</deferred>
