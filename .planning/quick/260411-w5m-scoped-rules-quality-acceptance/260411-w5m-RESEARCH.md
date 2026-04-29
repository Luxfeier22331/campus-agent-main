# Quick Task 260411-w5m Research

**Task:** 为 `regulations/scoped_rules` 完成 local-only chunk-prep / quality acceptance，并确认验收口径是否符合官方推荐
**Gathered:** 2026-04-11
**Status:** complete

## Task Boundary

本研究只回答三件事：

1. `scoped_rules` 当前应该如何做 local-only quality acceptance；
2. 哪些 metadata 缺口应作为 hard gate；
3. 真实验收时是否应该直接复用历史 local-smoke object-store 根目录。

本研究不做：

- query-serving reopen
- Qdrant / embedding / alias publish
- `current / historical / as_of / compare` 语义设计

## Repo Current Truth

- `regulations/scoped_rules` 已由 ADR-0037 冻结为统一 holding collection。
- 当前 posture 仍是 `offline_preparation + query_disabled`。
- repo 已补齐 `materialize_internal_notice_scoped_rules` downstream worker，但 `STATE.md` 仍把下一步停在 quality acceptance。
- `packages/ingestion-core/src/campus_ingestion_core/process.py` 已为 `scoped_rules` 接上 lane-aware chunk profile：
  - `annual_cycle_rule`
  - `time_bound_operational_rule`

## External Official Practices

### 1. 先做可重复 evaluation，再决定是否继续调 chunking

官方资料：

- Azure Databricks retrieval-quality 指南明确建议先建立可重复的评测与诊断，再决定是否调整检索、分块或 reranking。
- 参考：<https://learn.microsoft.com/en-us/azure/databricks/generative-ai/vector-search-retrieval-quality>

对本任务的直接含义：

- `scoped_rules` 现在应该先补一条 repo-owned acceptance harness；
- `short_body_chunk_count` 这类信号必须先被记录，再决定是否进入下一轮 tuning。

### 2. chunking 仍应优先尊重结构，再做尺寸控制

官方资料：

- Azure AI Search semantic / structure-aware chunking 文档强调先按标题、段落、章节等结构切分，再用 token budget 控制尺寸。
- 参考：<https://learn.microsoft.com/en-us/azure/search/search-how-to-semantic-chunking>

对本任务的直接含义：

- `scoped_rules` acceptance 不应退回统一窗口切分；
- 应直接消费当前 lane-aware profile，并检查 title/context/path metadata 是否完整。

### 3. metadata filter 字段应显式可验证，而不是回答后补救

官方资料：

- Azure AI Search vector filter 文档要求要用于过滤的字段显式进入 schema，并在 query 前参与过滤。
- 参考：<https://learn.microsoft.com/en-us/azure/search/vector-search-filters>

对本任务的直接含义：

- `document_nature`
- `source_notice_release_time`
- `cycle_year`（至少对 `annual_cycle_rule`）

这些字段都应该在 chunk acceptance 阶段就被 hard-check，而不是等未来 query-serving 时再发现缺口。

## Acceptance Posture

当前最合理的 acceptance 口径是：

- hard gate：
  - `missing_title_chunk_count = 0`
  - `missing_contextualization_count = 0`
  - `missing_projection_metadata_count = 0`
  - `missing_cycle_year_count = 0` for `annual_cycle_rule`
  - `wrapper_notice_leak_chunk_count = 0`
  - `front_matter_leak_chunk_count = 0`
- soft observation：
  - `short_body_chunk_count`

## Operator Rule

历史 `local-smoke/object-store` 根目录不应直接复用为本轮 acceptance 输出根。

原因：

- 它已经承载过多轮 scoped-rule / regulation local experiment artifacts；
- 当前 target-side artifact key 仍按 `document_id + revision_track + year` 组织，不应把历史临时输出与本轮 acceptance 输出混写到同一根目录；
- 对 local-only acceptance，使用 isolated snapshot root 更符合“read source snapshot -> write fresh target preview”这条边界。

这里的最后一条是基于 repo 当前 artifact 布局与官方 evaluation-first 原则的推断。

## Research Conclusion

结论只有一条：

- `scoped_rules` 的下一条 repo-local 动作就是补一条 isolated local-only acceptance harness，消费当前 materialization path 与 lane-aware chunk profile，冻结 hard-gate pass / soft-gap observation，并把“历史 local-smoke object-store 不能直接复用为 acceptance 输出根”写成 operator rule。

## Source Links

- Azure Databricks retrieval-quality guidance: <https://learn.microsoft.com/en-us/azure/databricks/generative-ai/vector-search-retrieval-quality>
- Azure AI Search semantic chunking: <https://learn.microsoft.com/en-us/azure/search/search-how-to-semantic-chunking>
- Azure AI Search vector filters: <https://learn.microsoft.com/en-us/azure/search/vector-search-filters>
