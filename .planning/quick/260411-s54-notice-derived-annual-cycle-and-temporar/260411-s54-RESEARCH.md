# Quick Task 260411-s54 Research

**Task:** 冻结 notice-derived `annual_cycle_rule` / `time_bound_operational_rule` 的 future collection strategy  
**Gathered:** 2026-04-11  
**Status:** complete

## Repo Facts

- 当前 query-enabled surface 仍只有：
  - `regulations/student_handbook`
  - `curriculum/curriculum_plan`
- `regulations/institutional_regulations` 当前仍是 `offline_preparation`
- repo 中不存在已冻结的 admissions/operator-facing semantic-owner collection
- Cohort A 的 `10` 条 manual-review notice 已完成语义裁决，但不应进入 `institutional_regulations`

## External Inputs

### Azure AI Search

- freshness 应建模为 ranking function / metadata，而不是 validity truth：
  - https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles
- filterable fields 需要显式进入 index schema：
  - https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index

推断：

- 这两类文档的 reopen 前提不是“先建 collection”，而是先冻结 query policy 所依赖的 metadata

### Qdrant

- 官方建议：大多数情况优先单 collection + payload partitioning；只有确实需要隔离时再拆多个 collections：
  - https://qdrant.tech/documentation/guides/multitenancy/

推断：

- 在 dedicated semantic-owner surface 尚未打开前，让这些文档继续停在 source-triage collection，比仓促造 collection 更稳

## Conclusion

- 现在应冻结 boundary，而不是新增 runtime-profile scaffold
- future collection 何时出现，必须由产品 reopen + query policy 一起驱动
