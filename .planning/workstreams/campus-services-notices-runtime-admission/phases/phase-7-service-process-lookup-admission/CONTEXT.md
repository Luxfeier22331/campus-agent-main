---
phase: "7"
name: "Service Process Lookup Admission"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 7 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结 `service_process_lookup` 作为 later-wave `campus-services-agent` tool 的准入边界
- 明确哪些校园服务办理步骤 / 材料 / 入口类问题在具备足够 normalized truth 后可进入 structured runtime
- 冻结 `campus_services/service_catalog` 作为 process-oriented semantic-owner truth 的前向 runtime owner
- 明确它与 `rag-specialist`、`contact_directory_lookup`、`service_status_lookup`、`official_web/stable_reference`、`regulations/student_rules` 的边界

它不负责：

- 打开 `service_catalog` query-serving surface
- 把 `service_catalog` 直接当成 generic retrieval alias
- 把所有制度 / 流程 / 办事说明问题都迁出 `rag-specialist`
- 重开 `Phase 1-6` 已冻结的边界、opening gate 或 later-wave `contact_directory_lookup` truth

</domain>

<current_truth>
## Current Truth

- `service_catalog` 已是 `campus_services` 下的长期 semantic-owner collection，但 runtime profile 仍是：
  - `serving_stage = offline_preparation`
  - `retrieval_enabled = false`
  - `query_enabled_by_default = false`
- offline-preparation hardening 已完成首条 bounded slice：
  - `中央民族大学学生公寓管理工作流程`
  - target-local artifact 包括 `flow-graph.json`、`canonical.md`、`document-units.jsonl`
- 当前 merged truth 仍要求：
  - 稳定制度 / 办理流程 / 材料说明问题继续由 `rag-specialist` 承接
  - 不把 `service_catalog` 文本检索或 raw source scan 冒充成 runtime query seam
- `official_web/stable_reference` 仍可承接公开办事说明、机构介绍、FAQ 等稳定说明正文，但它不是 `service_process_lookup` 的 canonical runtime owner。

</current_truth>

<decisions>
## Planning Decisions

- **07-01:** `service_process_lookup` 只承接 bounded service-process facts，不承接纯制度解释或校园一般知识问答。
- **07-02:** process lookup 的前向 truth owner 应是 `campus_services/service_catalog` 的 structured process projection，而不是 generic RAG chunk。
- **07-03:** 当前只有在某个服务已经具备足够 normalized process truth 时，才允许讨论迁入 structured runtime；否则继续留在 `rag-specialist`。
- **07-04:** `service_process_lookup` 可返回 related contact refs / entry refs，但不重新拥有联系方式 canonical truth。
- **07-05:** service name / audience / process variant 多解时优先 `needs_clarification`，缺 process graph / materials / entry truth 时优先 fail-close / unavailable。
- **07-06:** 本 phase 只冻结 admissible boundary 与 truth owner，不宣布 `service_catalog` runtime lane ready to open。

</decisions>

<specifics>
## Specific Gaps

- repo 当前还没有 `service_process_lookup` shared contract。
- 还没有把“哪些流程问题继续留在 `rag-specialist`，哪些未来可迁入 structured tool”写成明确规则。
- 还没有 `service_catalog` process projection 的 canonical field set、related contact linkage 与 fail-close semantics。
- 还没有把 handbook-derived flow graph、future official-web 办事说明页与 `regulations/student_rules` 条款边界统一写成 later-wave runtime truth。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/SUMMARY.md`
- `docs/decisions/adr-0005-campus-services-taxonomy.md`
- `configs/ingestion/campus_services/service_catalog/README.md`
- `configs/ingestion/campus_services/service_catalog/runtime-profile.json`
- `docs/plans/archive/completed/campus-services-offline-preparation-hardening.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- `docs/architecture/system/prompt-and-instruction-architecture.md`

</canonical_refs>

<deferred>
## Deferred Follow-up

- actual `service_process_lookup` shared contract implementation
- `campus-services-agent` tool adapter / query service seam
- product-path routing enablement
- any runtime opening / eval / observability freeze for this later-wave tool

</deferred>
