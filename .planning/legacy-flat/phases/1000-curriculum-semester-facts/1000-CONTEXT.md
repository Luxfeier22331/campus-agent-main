# Phase 1000: Curriculum 结构化证据契约与 Semester Facts 修复 - Context

> 2026-04-13 update: 本文档中的 `课程地图` 历史假设已被真实 OCR 抽样证据推翻。当前有效结论是：`课程设置` / `修读建议` 继续走 structured lookup，`课程地图` 改为 unsupported/fail-close。

**Gathered:** 2026-04-12
**Status:** Ready for research and planning
**Source:** Root-cause investigation + web best-practice review

<domain>
## Phase Boundary

本 phase 只处理 `curriculum/curriculum_plan` 当前 release-gate 中已经暴露出的 4 类同源问题：

1. `program_semester_facts` 已经成为 resolved single-program + single-semester follow-up 的 internal retrieval surface，但 eval / citation 仍把原始 `curriculum:*` 文档 id 当作唯一真相。
2. `program_semester_facts` 物化时对表格行列位置保持不足，遇到 merged / sparse table 会丢课，当前已在 `历史学（强基计划）第四学期` 复现为 `大学英语(四)` 缺失。
3. `课程设置` / `修读建议` 这类结构化 curriculum query 曾被 answer-shaping 路径误判为 `procedure`；`课程地图怎么安排` 则进一步误入 answer-bearing path，并退化成邻近表格摘录，造成伪 grounded 回答。
4. live eval / app-api trace 目前没有把 raw retrieval candidates 与 final supporting evidence 分开记录，导致 retrieval regression 与 answer-shaping regression 难以区分。

本 phase 的目标是把这些问题修回到 accepted retrieval-serving 边界内，而不是：

- 新增公开 serving surface
- 改写当前 merged truth 的 query-enabled scope
- 把 internal collection 升格为新的产品级 collection
- 重新设计 OCR / official-web / authenticated-notice lane

</domain>

<decisions>
## Implementation Decisions

### Retrieval / source contract

- `program_semester_facts` 保持为 `curriculum_plan` 选中 scope 下的 internal specialist retrieval surface，不回退为直接使用原始大文档作为 semester follow-up 的唯一 support source。
- eval、citation、observability 需要区分：
  - 真实命中的物理 source / projection unit
  - 面向产品与 operator 的 canonical curriculum source identity
- raw retrieval candidate truth 与 final supporting evidence truth 必须分开上报；不能继续把最终 answer evidence 伪装成完整 retrieval trace。

### Structured curriculum query path

- `课程设置`、`修读建议` 归入结构化 curriculum lookup，而不是 generic `procedure`。
- `课程地图` 仍需在 query interpretation 中被识别出来，但当前正确完成态是 `unsupported/fail-close`；不能继续进入 retrieval/support synthesis。
- 修复应落在 specialist planning / answer shaping 与 retrieval evidence coverage policy，不应把 alias / intent 语义下沉到 retrieval backend 黑盒字符串替换。

### Semester facts materialization

- `program_semester_facts` projection 必须改成 position-preserving table extraction。
- HTML / OCR table parsing 需要优先复用 repo 现有的 table cell / matrix utilities，而不是继续在该 projection 内维护一套弱化版表格解析。
- merged cells、blank leading cells、continued rows 不能通过“过滤空 cell”绕过；空 cell 在 projection 层具有列占位语义。

### Verification / release gate

- 本 phase 完成时，release-gate 需要明确区分：
  - source-contract drift
  - materialization data loss
  - answer-shaping coverage loss
- deterministic eval 应以 canonical source identity + required claim coverage 为主，而不是把某个 internal projection doc id 与某个旧 source doc id 强行当作同一层 truth。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product / planning truth

- `.planning/PROJECT.md` — 当前 merged truth、当前 active lane、以及 curriculum / eval 当前状态
- `.planning/STATE.md` — 当前 active phase 仍是 Phase 16；本 phase 是新增后续修复线
- `.planning/ROADMAP.md` — Phase 1000 phase record

### Retrieval / serving architecture

- `docs/architecture/retrieval-serving-architecture.md` — internal retrieval surface、selected scope 不漂移、retrieval pipeline 分层
- `docs/reference/runtime-serving-and-index-terms.md` — serving alias / physical collection / release manifest 术语

### Curriculum alias / specialist ownership

- `docs/decisions/adr-0021-institution-scoped-entity-alias-governance.md` — alias resolution owner 在 `rag-specialist`，不是 retrieval backend

### Root-cause code paths

- `packages/rag-specialist/src/campus_rag_specialist/service.py` — curriculum semester follow-up routing 与 supporting evidence build
- `packages/rag-specialist/src/campus_rag_specialist/agent.py` — `query_mode`、answer support row selection、curriculum answer shaping
- `packages/retrieval-core/src/campus_retrieval_core/evidence_ranking.py` — supporting evidence selection
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py` — curriculum document support overfetch / focused support query
- `packages/retrieval-core/src/campus_retrieval_core/curriculum_query_resolution.py` — curriculum query interpretation
- `packages/ingestion-core/src/campus_ingestion_core/curriculum_program_semester_facts_projection.py` — semester facts projection
- `packages/ingestion-core/src/campus_ingestion_core/source_truth_common.py` — table cell / span parsing utilities
- `packages/evals/src/campus_evals/scenarios.py` — failing golden cases
- `packages/evals/src/campus_evals/expectations.py` — internal collection allowance 与 procedure-goal logic
- `packages/evals/src/campus_evals/app_api_chat_runtime.py` — observed trace projection

</canonical_refs>

<specifics>
## Specific Facts To Preserve

- `curriculum-release-gate-program-follow-up-session-replay`
  - 当前 answer 通过，但 source contract 失败
  - runtime 实际返回 `program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4`
- `curriculum-release-gate-strong-base-follow-up-session-replay`
  - 当前既有 source contract drift，也有真实数据缺损
  - `program_semester_facts:历史学（强基计划）本科人才培养方案:semester-4` 现缺 `大学英语(四)`
- `curriculum-release-gate-course-map-unsupported`
  - 当前目标不再是 course-map answer shaping，而是 fail-close
  - runtime 不应调用 retriever，也不应保留 final supporting evidence
  - deterministic gate 需要锁定 `no_answer_reason=curriculum_course_map_unsupported`、`semantic_outcome=unsupported_scope`、`retrieval_called=False`

</specifics>

<deferred>
## Deferred Ideas

- 不在本 phase 内扩大 curriculum serving surface
- 不在本 phase 内引入新的课程数据源，例如 offering unit / 开课学院
- 不在本 phase 内执行全量 rerun / 全量重建所有 curriculum collection；只在修复完成后按需要重物化受影响的 `program_semester_facts`

</deferred>

---

*Phase: 1000-curriculum-semester-facts*
*Context gathered: 2026-04-12 via root-cause investigation + web review*
