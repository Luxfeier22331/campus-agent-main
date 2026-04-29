# Quick Task 260411-u0t Research

**Task:** 补齐 scoped_rules materialization 与验证  
**Gathered:** 2026-04-11  
**Status:** complete

## Repo Facts

- `regulations/scoped_rules` 已由 `ADR-0037` 冻结为 unified holding collection。
- 当前 source-side read-only manifest 仍会把这两类文档标成 `manual_review_required`。
- 本轮目标不是改写 source truth，而是补齐 downstream materialization，使已裁决 scoped-rule 文档有明确落点。

## External Inputs

- Azure AI Search index schema 需要显式定义字段能力；适合先保留最小 metadata，再后置 query semantics：
  - https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index
- Azure AI Search freshness 属于 scoring function，而不是 validity truth：
  - https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles
- Qdrant payload 是与向量一起存储的 JSON metadata，可用于后续 filter/partition：
  - https://qdrant.tech/documentation/manage-data/payload/
- 对当前项目的推断：scoped rules 先集中导入单一 holding collection，并保留 payload 级 provenance / year / unit metadata，比提前拆 query surface 更稳。

## Conclusion

- 先打通 `internal_notice -> regulations/scoped_rules` 的 repo-local materialization。
- 保持 `offline_preparation + query_disabled` 不变。
- duplicate aggregation 必须复用 promotion 阶段已有的 duplicate identity，而不能退回到 source document 级别。
