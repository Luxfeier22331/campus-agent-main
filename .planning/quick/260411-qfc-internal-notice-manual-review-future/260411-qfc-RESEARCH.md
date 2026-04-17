# Quick Task 260411-qfc Research

**Task:** 冻结 internal notice manual-review buckets 的 future query contract  
**Gathered:** 2026-04-11  
**Status:** complete

## Repo Facts

- 当前 query-enabled surface 仍只有：
  - `regulations/student_handbook`
  - `curriculum/curriculum_plan`
- `annual_cycle_rule` 与 `time_bound_operational_rule` 当前继续停在 `campus_notices/internal_notice/manual_review_required`
- ADR-0036 已冻结“不提前新建 collection scaffold”，但还没把 future reopen 所需的 query contract 写细
- retrieval architecture 已冻结为：
  - `query framing -> version/surface selection -> metadata filter -> candidate retrieval -> fusion/ranking -> evidence shaping`

## External Inputs

### Azure AI Search

- 过滤字段必须显式声明；向量过滤支持 prefilter / postfilter：
  - https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index
  - https://learn.microsoft.com/en-us/azure/search/vector-search-filters
- freshness 是 scoring function，不是 validity truth：
  - https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles

推断：

- year / site / effective window 这些 future contract 字段必须先成为 metadata/filter truth，不能留给回答层补救

### Qdrant

- payload filter / facet 是一等能力：
  - https://qdrant.tech/documentation/concepts/payload/
- 大多数场景优先单 collection + payload partitioning，只有确实需要隔离时再拆 collection：
  - https://qdrant.tech/documentation/guides/multitenancy/

推断：

- 现在应先冻结 metadata/query contract，而不是抢先给未来 bucket 命名并写 `runtime-profile.json`

## Conclusion

- 本轮正确动作是补 future query contract 文档，不是再造 collection scaffold
- `annual_cycle_rule` 必须走 `explicit_year_only`
- `time_bound_operational_rule` 必须走显式 temporal policy，并在命中时显示 warning/status
