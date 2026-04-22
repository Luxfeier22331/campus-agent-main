---
phase: "1"
name: "Agent And Tool Boundary Freeze"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 1 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结 `supervisor`、`campus-services-agent`、`notice-agent`、`navigation-agent`、`rag-specialist` 的 runtime boundary
- 冻结首发 `4` 个 tool 的 closed-set scope：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- 冻结 `current/latest/effective/current-year miss` 的时间语义与 fail-close 口径
- 冻结 notice runtime 的 source matrix、historical downgrade 与 current-truth / target-truth label mapping
- 为 `Phase 2` 的 strict contract freeze 提供 execution-ready inputs

它不负责：

- 新增 runtime implementation、query service、tool adapter 或 app route
- 打开 `campus_services/*`、`campus_notices/internal_notice`、`official_web/fresh_news` 的 query-serving
- 重开 `campus-services-offline-preparation-hardening`
- 实现 route planning / map UI / browser geolocation
- auth-dependent live capture、`file_release` owner recovery
- repo-wide `*-specialist -> *-agent` current-truth rename

</domain>

<current_truth>
## Current Truth

- 当前 accepted merged truth 的 query-enabled surface 仍只有：
  - `regulations/student_rules`
  - `curriculum/curriculum_plan`
- `campus_services/*` 当前仍是 `offline_preparation`；`service_catalog` runtime profile 仍是：
  - `retrieval_enabled=false`
  - `query_enabled_by_default=false`
- `campus_notices/internal_notice` 当前仍是 `offline_preparation` restricted source-triage collection，不是 formal regulation surface。
- `official_web/fresh_news` 当前也仍是 `offline_preparation`，并且长期上与 future `notice-agent` 不是同一层。
- target / planning truth 已经显式写入：
  - `campus-services-agent` 拥有 `service_status_lookup`、`transport_schedule_lookup`
  - `notice-agent` 拥有 `campus_notice_discover`、`campus_notice_get`
  - `navigation-agent` 只消费 transport/service point refs，不拥有 timetable truth 或 service-status truth
  - 稳定制度/流程/材料类问题继续由 `rag-specialist` 承接
- 当前 code/contract 还没有这些新 family：
  - `SpecialistTarget` 目前只有 `rag-specialist`、`availability-specialist`、`navigation-specialist`
  - `SpecialistRequest.payload` 目前只有 `RagRequestPayload | AvailabilityCheckPayload | PlaceLookupPayload`
  - `SupervisorAgent` 当前只注册了 `rag-specialist`、`availability-specialist`、`navigation-specialist`
- 当前 top-level routing 行为继续是：
  - `availability` capability 可直接走 `availability-specialist`
  - `place_lookup` 目前产品路径 fail-close
  - `campus_services/service_catalog` 作为 knowledge scope 仍被拒绝
- 这条 workstream 当前只有 `REQUIREMENTS.md`、`ROADMAP.md`、`STATE.md`，没有 phase-local artifacts。

</current_truth>

<decisions>
## Implementation Decisions

- **01-01:** `Phase 1` 的 owner 是 boundary freeze，不是 implementation bootstrap。先把边界写成 repo-tracked truth，再进入 `Phase 2-4` 的 payload / query service / wiring。
- **01-02:** `supervisor` 继续只负责 routing / terminal semantics，不直接拥有 `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover`、`campus_notice_get`。
- **01-03:** `campus-services-agent` 首发只拥有 `service_status_lookup` 与 `transport_schedule_lookup`；`notice-agent` 首发只拥有 `campus_notice_discover` 与 `campus_notice_get`；`navigation-agent` 继续只消费 point refs；`rag-specialist` 继续处理稳定制度/流程/材料问题。
- **01-04:** `transport_notice_latest` 与 `transport_pickup_point_lookup` 在本 phase 固定保持 deferred，不因“很接近首发工具”而一起 admission。
- **01-05:** `campus_notice_discover/get` 的 runtime source matrix 必须显式区分：
  - public `official_web` notice-like pages
  - restricted `campus_notices/internal_notice`
  当前 phase 只冻结 owner/routing 口径，不授权具体 source opening。
- **01-06:** `current/latest/effective/current-year miss` 必须是 contract truth，不允许继续留给 prompt 或 retrieval 自猜。
- **01-07:** `Phase 1` 需要显式写出 current-truth / target-truth label mapping：
  - current code/contract 仍允许使用 `*-specialist`
  - target/planning truth 可继续使用 `campus-services-agent` / `notice-agent`
  但本 phase 不执行 repo-wide rename。
- **01-08:** `Phase 1` 不得通过 `app-api` loopback HTTP、browser/public API、或 raw notice/source bundle scan 来伪造未来的 internal query service。

</decisions>

<specifics>
## Specific Gaps

- 还没有 `campus-services-agent` / `notice-agent` 的 shared target enum、payload、result model。
- 还没有“服务开放状态 vs 稳定制度/流程”这组 routing split 的 code-owned truth。
- 还没有“public notice-like pages vs restricted internal notices”的 source matrix freeze。
- 还没有 current-year miss / historical downgrade 的统一 output semantics。
- 还没有把这条线与 `execution-capability-family-convergence` 的命名边界写成 phase-local rule。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/REQUIREMENTS.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `docs/architecture/product-positioning.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `configs/ingestion/campus_services/service_catalog/runtime-profile.json`
- `configs/ingestion/campus_notices/internal_notice/runtime-profile.json`
- `configs/ingestion/official_web/fresh_news/runtime-profile.json`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/supervisor-core/src/campus_supervisor_core/routing.py`
- `packages/supervisor-core/src/campus_supervisor_core/framing.py`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `tests/supervisor/test_supervisor_routing.py`
- `tests/supervisor/test_supervisor_query_policy.py`
- `tests/specialist/test_rag_specialist.py`
- `docs/plans/execution-capability-family-convergence.md`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 2`: payload/result schema、status enum、output shape
- `Phase 3`: source-truth / normalized-truth lane 与 query projection shape
- `Phase 4`: internal query service、tool adapter、handoff wiring
- `Phase 5`: eval / observability / opening gate
- route planning / map UI / geolocation
- authenticated notice live capture、`file_release` owner recovery
- repo-wide label migration

</deferred>
