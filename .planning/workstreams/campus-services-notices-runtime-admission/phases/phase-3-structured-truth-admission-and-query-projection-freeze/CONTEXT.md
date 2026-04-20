---
phase: "3"
name: "Structured Truth Admission And Query Projection Freeze"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 3 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结首发 `4` 个 tool 各自消费的 source-truth / normalized-truth lane：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- 冻结每个 tool 的 query projection shape、required metadata、source family split 与 fail-close filter
- 冻结 projection-backed internal query service 未来应该读哪些 repo-owned projection，而不是读哪些 raw/retrieval alias
- 为 `Phase 4` 的 internal query service / tool adapter wiring 提供 execution-ready truth owner

它不负责：

- 新增 runtime implementation、internal query service endpoint、tool adapter 或 supervisor wiring
- 打开 `service_catalog`、`internal_notice`、`fresh_news` 的 query-serving
- 重写 data plane、collector 或 source-truth contract
- 让 generic RAG 直接消费 transport / notice / service status raw source

</domain>

<current_truth>
## Current Truth

- `Phase 1` 已冻结 capability boundary、notice source matrix 与 temporal fail-close semantics。
- `Phase 2` 已把四个首发 tool 的 payload/result schema、outcome enum 与 temporal vocabulary 落进 `packages/contracts`。
- 当前 relevant runtime profiles 仍然是：
  - `campus_services/service_catalog`
    - `serving_stage=offline_preparation`
    - `retrieval_enabled=false`
    - `query_enabled_by_default=false`
  - `campus_notices/internal_notice`
    - `serving_stage=offline_preparation`
    - `retrieval_enabled=false`
    - `query_enabled_by_default=false`
  - `official_web/fresh_news`
    - `serving_stage=offline_preparation`
    - `retrieval_enabled=false`
    - `query_enabled_by_default=false`
- `service_catalog` 当前已有 handbook-derived hybrid materialization pattern，但它仍是 offline-preparation collection，不是 generic query-serving surface。
- `official_web` 当前已有 projection declarations / routing / validation pattern；`fresh_news` 已冻结 article-detail evidence 与 freshness metadata 要求，但仍未 opening。
- `internal_notice` 当前已有 source-truth replay / source projection / attachment projection owner；collection posture仍是 restricted notice source family，而不是 public query surface。
- 当前还没有：
  - 面向 `service_status_lookup` 的 current-effective status projection truth
  - 面向 `transport_schedule_lookup` 的 route/window/stop projection truth
  - 面向 `campus_notice_discover/get` 的 public notice projection 与 restricted notice projection query seam
  - 一个把这 `4` 个 tool 与 raw retrieval alias 清晰隔离的 query projection filter

</current_truth>

<decisions>
## Implementation Decisions

- **03-01:** `Phase 3` 冻结的是 “tool -> projection truth” 映射，不是 “tool -> current retrieval collection” 映射。不得把 query-disabled collection alias 伪装成 runtime query seam。
- **03-02:** `service_status_lookup` 与 `transport_schedule_lookup` 的 truth owner 必须是 projection-backed structured lane，而不是 `service_catalog` 文本检索或 query-time raw scan。
- **03-03:** `campus_notice_discover/get` 必须显式区分 source family：
  - public `official_web` notice-like pages
  - restricted `campus_notices/internal_notice`
  两者可以在 future runtime 被同一 `notice-agent` 消费，但 projection truth 不能先混平。
- **03-04:** `official_web/fresh_news` opening 与 notice runtime consumption 继续是两条不同问题：
  - `fresh_news` 是 retrieval surface
  - `campus_notice_discover/get` 是 structured notice runtime
  `Phase 3` 只冻结后者所需的 projection truth，不自动打开前者。
- **03-05:** `internal_notice` 继续只是 restricted notice source family；`Phase 3` 只能冻结其被 future notice runtime 消费时所需的 projected notice metadata / canonical body seam，不改写 collection posture。
- **03-06:** query projection 必须至少能承接 `Phase 2` 已冻结的字段：
  - current/effective time anchor
  - historical downgrade reason
  - fail-close reason
  - source family / source URL / related notice refs / stop refs
- **03-07:** 任何 future internal query service 都只能读取 repo-owned projection / normalized truth，不得：
  - 扫 raw source bundle
  - 直接读 browser-facing API
  - 走 `app-api` loopback HTTP

</decisions>

<specifics>
## Specific Gaps

- `service_status_lookup` 还没有明确的 status projection owner、subject identity fields 与 override projection shape。
- `transport_schedule_lookup` 还没有明确的 route/service window/stop ref projection owner。
- `campus_notice_discover/get` 还没有明确的 public notice projection 与 restricted notice projection 如何并排进入 query seam。
- 还没有把 future query projection filter 写成 “只读 projected truth，不读 query-disabled retrieval alias” 的 phase-local rule。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/REQUIREMENTS.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-2-tool-contract-freeze/SUMMARY.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `configs/ingestion/campus_services/service_catalog/runtime-profile.json`
- `configs/ingestion/campus_notices/internal_notice/runtime-profile.json`
- `configs/ingestion/official_web/fresh_news/runtime-profile.json`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_service_navigation_hybrid_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/official_web_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 4`: internal query service、tool adapter、handoff wiring
- `Phase 5`: eval / observability / opening gate
- `Phase 6`: `contact_directory_lookup`
- `Phase 7`: `service_process_lookup`
- any query-serving opening for `service_catalog` / `internal_notice` / `fresh_news`

</deferred>
