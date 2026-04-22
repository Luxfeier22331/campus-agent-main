---
phase: "2"
name: "Tool Contract Freeze"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 2 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 为首发 `4` 个 tool 冻结 shared payload/result contract：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- 冻结这 `4` 个 tool 的 status enum、temporal semantics、historical downgrade 与 fail-close output shape
- 冻结这些 contract 在 `packages/contracts` 中的长期落点、命名方式与与 `SupervisorRequest` / `SpecialistRequest` / `SpecialistResponse` 的关系
- 为 `Phase 3` 的 structured truth admission 和 `Phase 4` 的 wiring 提供 execution-ready contract truth

它不负责：

- 新增 runtime implementation、internal query service、tool adapter 或 app route
- 打开 `campus_services/*`、`campus_notices/internal_notice`、`official_web/fresh_news` 的 query-serving
- 先行决定 source-truth / projection 的具体 materialization shape
- 执行 repo-wide `*-specialist -> *-agent` label migration
- 把 later-wave `contact_directory_lookup` / `service_process_lookup` 提前并入首发 contract

</domain>

<current_truth>
## Current Truth

- `Phase 1` 已冻结 runtime boundary：
  - `campus-services-agent` 首发拥有 `service_status_lookup`、`transport_schedule_lookup`
  - `notice-agent` 首发拥有 `campus_notice_discover`、`campus_notice_get`
  - `navigation-agent` 只消费 point refs
  - `rag-specialist` 继续承接稳定制度/流程/材料类问题
- 当前 `packages/contracts/src/campus_contracts/models.py` 仍只有：
  - `SpecialistTarget = "rag-specialist" | "availability-specialist" | "navigation-specialist"`
  - `RequestedCapability = "knowledge" | "availability" | "place_lookup"`
  - `RagRequestPayload | AvailabilityCheckPayload | PlaceLookupPayload`
  - `RagResultPayload | AvailabilityObservation | PlaceLookupResult`
- `packages/contracts/src/campus_contracts/__init__.py` 的 export seam 仍围绕上述 union 展开；还没有首发 `4` 个 tool 的专属 payload/result model。
- `packages/supervisor-core/src/campus_supervisor_core/routing.py` / `framing.py` / `agent.py` 当前仍只接 `rag-specialist`、`availability-specialist`、`navigation-specialist` 这三条 current-truth branch。
- 当前已冻结的重要边界：
  - `service_catalog`、`internal_notice`、`fresh_news` 继续不是 query-enabled surface
  - `campus_notice_discover/get` 是 notice task，不是 retrieval alias
  - `current/latest/effective/current-year miss` 必须进入 code-owned truth
- 当前还没有：
  - 四个首发 tool 的 shared dataclass / enum / provenance field 契约
  - `campus_notice_discover` discovery card 与 `campus_notice_get` canonical body 的分离输出 shape
  - tool-level fail-close reason / historical downgrade reason 的 shared enum

</current_truth>

<decisions>
## Implementation Decisions

- **02-01:** `Phase 2` 的 contract freeze 以 tool identity 为锚点，而不是以当前 `*-specialist` 或前向 `*-agent` label 为锚点。label coexistence 不得反向造成 schema churn。
- **02-02:** 首发 `4` 个 tool 必须各自拥有独立 payload/result dataclass；不得继续复用 `RagRequestPayload`、`AvailabilityCheckPayload` 或自由文本 prompt packet 来偷渡结构化语义。
- **02-03:** temporal semantics 必须进入 shared contract truth，而不是停留在 `answer_text` wording：
  - `current`
  - `latest`
  - `effective`
  - `as_of`
  - `current-year miss`
  - `historical downgrade`
- **02-04:** tool outcome enum 必须与 `DelegateStatus` / `SupervisorStatus` 分离。delegate status 表示执行链路状态；tool outcome 表示业务语义结果，例如 current hit、historical reference only、temporarily unverifiable、not found。
- **02-05:** `campus_notice_discover` 与 `campus_notice_get` 不得共用一个结果模型：
  - discover 返回 notice card / summary list
  - get 返回 canonical notice body + source/provenance/temporal metadata
- **02-06:** `campus_notice_get` 不得退化成 link-only contract；至少要冻结 normalized body、source family、source URL、发布时间/生效时间一类字段。
- **02-07:** `service_status_lookup` 与 `transport_schedule_lookup` 的结果必须显式带出“当前状态是否可证”“命中的有效时间窗”“是否存在 override / related notice provenance”；fail-close 不能只靠自然语言表达。
- **02-08:** `Phase 2` 只冻结 contract shape，不冻结具体 projection 表、query service API 或 source-truth owner；这些在 `Phase 3-4` 收口。

</decisions>

<specifics>
## Specific Gaps

- 还没有共享的 temporal request helper 来承接 `current/latest/effective/as_of`。
- 还没有共享的 historical downgrade / fail-close outcome taxonomy。
- 还没有 notice discovery card 与 canonical notice body 的分层 contract。
- 还没有为首发 `4` 个 tool 预留 `packages/contracts` export seam、测试入口与 union 扩展路径。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/REQUIREMENTS.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/SUMMARY.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/contracts/src/campus_contracts/__init__.py`
- `packages/supervisor-core/src/campus_supervisor_core/routing.py`
- `packages/supervisor-core/src/campus_supervisor_core/framing.py`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `tests/supervisor/test_supervisor_routing.py`
- `tests/supervisor/test_supervisor_query_policy.py`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 3`: source-truth / normalized-truth owner、projection shape、query projection filter
- `Phase 4`: internal query service、tool adapter、handoff wiring、per-agent allowed tools
- `Phase 5`: eval / observability / opening gate
- `Phase 6`: `contact_directory_lookup`
- `Phase 7`: `service_process_lookup`
- repo-wide label migration

</deferred>
