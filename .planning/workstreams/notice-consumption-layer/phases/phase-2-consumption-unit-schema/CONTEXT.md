---
phase: "2"
name: "Consumption Unit Schema"
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

- 为 `derived consumption unit` 冻结最小正式 schema
- 冻结 schema 的字段分组：
  - identity
  - provenance
  - role / owner
  - default routing hint
  - target surface hint
  - temporal policy
  - completeness
  - answerability
- 冻结哪些字段应直接复用 repo 已有 metadata 命名，哪些只是 downstream alias
- 为 `Phase 3` 的 authority / completeness 规则和 `Phase 4` 的 agent/surface handoff 提供 execution-ready schema truth

它不负责：

- 直接实现 dataclass、projection builder 或 query service
- 重写 `packages/contracts` 里的 runtime tool payload/result
- 打开 `fresh_news`、restricted notice runtime 或任何新 query surface
- 冻结 authority / precedence / attachment missing 的最终判定规则

</domain>

<current_truth>
## Current Truth

- `Phase 1` 已冻结：
  - `source_notice`
  - `notice_attachment`
  - `derived consumption unit`
  三层关系，以及两个 admitted notice source family：
  - `official_web_public_notice`
  - `internal_notice_restricted`
- 当前 repo 已经有 runtime tool 级 shared contract：
  - `TemporalQuery`
  - `NoticeCard`
  - `CampusNoticeDiscover*`
  - `CampusNoticeGet*`
  - `ServiceStatusLookup*`
  - `TransportScheduleLookup*`
  这些属于 structured runtime seam，不是 derived consumption unit schema 本身。
- data plane 已冻结 canonical chain：
  - `source truth -> declared projections -> canonical document artifacts`
- 现有 downstream materialization 已经使用一批稳定 metadata：
  - `document_nature`
  - `semantic_owner_kind`
  - `source_notice_release_time`
  - `source_attachment_ref_id`
  - `effective_date`
  - `cycle_year`
  - `school_unit_name`
  - `campus_site`
- 这些字段已经在 `internal_notice -> scoped_rules` 与 `internal_notice -> institutional_rules` 里部分成立，但 repo 还没有一层更上游、source-family-neutral 的 consumption unit schema。

</current_truth>

<decisions>
## Implementation Decisions

- **02-01:** derived consumption unit schema 属于 data-plane projection contract，不属于 supervisor runtime request/result contract。
- **02-02:** `Phase 2` 的 schema 以 `source_notice` fan-out 的 typed unit 为锚点，不以 `campus_notice_discover/get` 或 `service_status_lookup` 这类 runtime tool 为锚点。
- **02-03:** schema 至少必须包含以下字段组：
  - identity:
    - `unit_id`
    - `source_family`
  - provenance:
    - `source_notice_id`
    - `source_notice_release_time`
    - `source_attachment_ref_ids`
    - `source_notice_link`
    - `derived_from_raw_asset_id`
    - `derived_from_raw_version_id`
  - role / owner:
    - `primary_role`
    - `semantic_owner`
  - routing / target:
    - `default_agent`
    - `target_surface`
  - temporal / completeness:
    - `temporal_policy`
    - `completeness_status`
    - `answerability`
  - role-scoped metadata:
    - `role_metadata`
- **02-04:** `primary_role` 是 upstream role enum；下游 `document_nature` / `content_role` 只应作为 projection-specific alias，不应反向替代 `primary_role`。
- **02-05:** `semantic_owner` 必须与现有 `semantic_owner_kind` 保持语义对齐，至少能区分：
  - `notice_body`
  - `attachment_document`
  - `wrapper_notice`
  - `authority_pending`
- **02-06:** `default_agent` 是默认 routing hint，不等于 runtime 已 admission，也不等于长期唯一 consumer；当前至少允许：
  - `notice-agent`
  - `rag-agent`
  - `campus-services-agent`
- **02-07:** `target_surface` 是 repo-owned downstream target hint，不等于已 opened surface；当前至少需要支持：
  - `notice_runtime`
  - `regulations/scoped_rules`
  - `regulations/institutional_rules`
  - `service_status_runtime`
  - `publication_surface_candidate`
- **02-08:** `temporal_policy` 必须独立于 runtime query mode，至少能表达：
  - `announcement_window`
  - `explicit_year_only`
  - `time_windowed`
  - `current_override`
  - `point_in_time_publication`
  - `standing_until_replaced`
- **02-09:** `completeness_status` 与 `answerability` 在本 phase 必须成为正式字段，但它们的 derivation rule 留给 `Phase 3`；本 phase 只冻结 value-space 需要覆盖的状态。
- **02-10:** role-scoped metadata 不应被全部抬成顶层字段；例如：
  - `cycle_year`
  - `school_unit_name`
  - `campus_site`
  - `effective_date`
  - `published_at`
  应按 `primary_role` 进入 `role_metadata`，再由 downstream projection 显式展开。

</decisions>

<specifics>
## Specific Gaps

- 还没有 neutral `derived consumption unit` identity / provenance contract。
- 还没有把 `primary_role` 与 `document_nature` / `content_role` 的上下游关系写清。
- 还没有把 `semantic_owner` 和现有 `semantic_owner_kind` 对齐。
- 还没有写清哪些 metadata 是顶层公共字段，哪些只是 role-scoped metadata。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/notice-consumption-layer.md`
- `.planning/workstreams/notice-consumption-layer/REQUIREMENTS.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/PLAN.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/reference/internal-notice-manual-review-future-query-contract.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_scoped_rule_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 3`
  - `completeness_status` derivation rule
  - `answerability` derivation rule
  - `semantic_owner` 的最终 authority 判定
- `Phase 4`
  - `default_agent` / `target_surface` 如何进入 runtime routing truth
- `Phase 5`
  - worked example closeout
  - adoption routing

</deferred>
