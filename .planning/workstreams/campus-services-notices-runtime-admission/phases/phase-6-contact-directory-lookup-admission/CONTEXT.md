---
phase: "6"
name: "Contact Directory Lookup Admission"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 6 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结 `contact_directory_lookup` 作为 later-wave `campus-services-agent` tool 的准入边界
- 明确联系方式 / 部门电话 / 办公电话 / 邮箱 / 办公地点这类问句何时进入 structured runtime，而不是 generic RAG
- 冻结 `campus_services/contact_directory` 的 truth owner、query projection、provenance 与 fail-close / clarification 语义
- 明确它与 `official_web/stable_reference`、`rag-specialist`、`service_process_lookup` 的边界

它不负责：

- 打开 `contact_directory` query-serving surface
- 把 `service_process_lookup` 或 `service_status_lookup` 的问题并入本 tool
- 重开 `Phase 1-5` 已冻结的首发 `4` 个 tool boundary / opening gate
- 把浏览器 contract、panel contract 或 `app-api -> supervisor-api` seam 扩张成新的公开接口

</domain>

<current_truth>
## Current Truth

- `campus_services/contact_directory` 已存在 repo-admitted taxonomy 与 runtime profile：
  - `serving_stage = offline_preparation`
  - `retrieval_enabled = false`
  - `query_enabled_by_default = false`
- `contact_directory` 当前是 semantic-owner collection，不是 product-path query-enabled surface。
- handbook 电话页已不再保留为 `regulations/student_rules` 的 split truth，而是后续应派生进入 `campus_services/contact_directory`。
- `official_web/stable_reference` 长期也能承接公开说明页、院系概况与联系方式页面，但它是 stable-reference RAG surface，不自动替代 `contact_directory_lookup` 的 structured tool truth。
- `Phase 5` 已冻结：首发 `4` 个 tool 的 opening gate 仍保持 closed until backing truth + release-gate evidence ready。

</current_truth>

<decisions>
## Planning Decisions

- **06-01:** `contact_directory_lookup` 只处理 bounded contact facts，不处理制度说明、办事流程、营业状态或服务可用性。
- **06-02:** contact query 的 runtime truth owner 应是 `campus_services/contact_directory` 的 structured projection，而不是 generic RAG chunk 命中。
- **06-03:** `official_web` / handbook / future campus directory 页面可以作为 source family / provenance 上游，但不能在 runtime query 时直接替代 canonical contact projection。
- **06-04:** 人名 / 部门 / 办公室 / alias resolution 若存在多解，优先 `needs_clarification`，而不是猜测联系人。
- **06-05:** 缺 canonical current contact truth、缺 provenance 或 currentness 不可证实时，应 fail-close / unavailable，而不是把历史目录或弱匹配结果伪装成当前联系方式。
- **06-06:** 本 phase 只冻结 bounded tool contract 与 truth owner；是否真的打开 product runtime lane，仍属于后续 implementation + gate evidence 讨论。

</decisions>

<specifics>
## Specific Gaps

- repo 当前还没有 `contact_directory_lookup` 的 shared contract。
- 还没有 `campus-services-agent` 针对联系方式查询的 bounded tool surface / query class freeze。
- 还没有 `contact_directory` query projection 的 canonical field set、provenance 字段与 fail-close 口径。
- 还没有明确规定：哪些联系方式问题继续由 `official_web/stable_reference` / `rag-specialist` 承接，哪些应迁入 structured runtime。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-5-verification-and-opening-gate/SUMMARY.md`
- `docs/decisions/adr-0005-campus-services-taxonomy.md`
- `configs/ingestion/campus_services/contact_directory/README.md`
- `configs/ingestion/campus_services/contact_directory/runtime-profile.json`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- `docs/policies/official-web-cleaning-and-chunking-policy.md`
- `docs/reference/student-handbook-normalization-strategy.md`

</canonical_refs>

<deferred>
## Deferred Follow-up

- actual `contact_directory_lookup` shared contract implementation
- `campus-services-agent` tool adapter / query service seam
- product-path routing enablement
- opening gate / observability closeout for this later-wave tool

</deferred>
