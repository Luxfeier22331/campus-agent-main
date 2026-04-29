# Quick Task 260411-sru Research

**Task:** 统一 `annual_cycle_rule` / `time_bound_operational_rule` 的 import-first holding collection  
**Gathered:** 2026-04-11  
**Status:** complete

## Repo Facts

- 这 10 条文档当前不应进入 `regulations/institutional_regulations`
- 继续把它们留在 `internal_notice/manual_review_required` 会阻塞 import
- 当前目标是先导入 canonical text，不是先开放 query-serving

## External Inputs

- Azure AI Search：过滤字段要显式进 schema，freshness 是 ranking 不是 validity truth
  - https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index
  - https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles
- Qdrant：payload 是一等 metadata/filter 载体；只有确实需要隔离时再拆更多 collection
  - https://qdrant.tech/documentation/concepts/payload/
  - https://qdrant.tech/documentation/guides/multitenancy/

## Conclusion

- 当前最稳的 repo truth 是一个统一的 `regulations/scoped_rules` holding collection
- 先 import，后置 query semantics
- posture 固定为 `offline_preparation + query_disabled`
