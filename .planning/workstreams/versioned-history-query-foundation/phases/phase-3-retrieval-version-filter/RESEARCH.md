---
doc_type: phase_research
phase: "3"
phase_name: "Retrieval Version Filter"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 3 Research

## External Sanity Check

本 phase 做了最小联网校验，只使用一手官方文档确认“版本约束应在 retrieval filter 阶段前推”这一点：

- Qdrant filtering docs：
  - `https://qdrant.tech/documentation/concepts/filtering/`
  - 明确说明 payload / id filtering 适用于 embedding 不能表达的 business constraints。
- Azure AI Search vector filter docs：
  - `https://learn.microsoft.com/en-us/azure/search/vector-search-filters`
  - 明确区分 `preFilter / postFilter / strictPostFilter`，并说明 prefilter 是在 ANN traversal 期间缩小候选集合。

## Implementation Implication

结合当前 repo 场景，得到的工程结论是：

1. `version_id / revision_track` 属于 retrieval metadata/business constraint，不应交给 embedding 自己表达。
2. 若已由 registry resolver 给出明确版本选择，最小正确做法是把它前推成 backend 过滤条件。
3. 对于 `current_only` collection，如果请求显式指向历史 `version_id`，继续保留默认 `is_current=True` 会把目标候选过滤掉，因此必须让显式 version filter 覆盖默认 current-serving 行为。
4. 当前 phase 不需要把 retrieval backend 变成通用 temporal query engine；只需要承载上游已解析好的 bounded selection truth。

## Deferred To Phase 4+

- compare 双侧 evidence 如何呈现给用户
- non-current answer wording
- richer unresolved explanation / clarification
