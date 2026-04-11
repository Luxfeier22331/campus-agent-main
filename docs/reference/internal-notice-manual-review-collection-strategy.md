---
doc_type: reference
status: active
created: 2026-04-11
updated: 2026-04-11
---

# Internal Notice Manual-Review Collection Strategy

## 文档边界

本文记录 `campus_notices/internal_notice` 当前 `manual_review_required` 中、已完成语义裁决的两类文档：

- `annual_cycle_rule`
- `time_bound_operational_rule`

它回答的是：

- 为什么这些文档当前不能进入 `regulations/institutional_regulations`
- 为什么当前改为先进入统一 holding collection `regulations/scoped_rules`
- 哪些 query 语义明确后置，不再作为当前 import gate

它不回答：

- `scoped_rules` 何时进入 query-serving
- 未来 admissions / operations 产品入口何时开放
- query-serving reopen 之后的完整 query-planning 细节

## 当前冻结结论

### Bucket A: `annual_cycle_rule`

当前 Cohort A 中属于这类的文档：

- `186957 / 中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则`
- `186977 / 药学院2021年硕博连读博士研究生招生实施细则`
- `187004 / 历史文化学院2021年硕博连读博士研究生 招生实施细则`
- `196411 / 中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则`
- `351907 / 新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则`
- `353963 / 中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则`
- `354006 / 中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则`

固定判断：

- 这些文档是可消费文本，但不是长期 institution-wide regulation
- 它们的主要 retrieval 维度是：
  - year
  - program
  - school unit
- 因此当前不能直接放进 `regulations/institutional_regulations`

当前默认 query policy：

- `explicit_year_only`

### Bucket B: `time_bound_operational_rule`

当前 Cohort A 中属于这类的文档：

- `191176 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定`
- `191177 / 生命与环境科学学院关于2021年暑假期间实验室安全管理规定`
- `191705 / 重要通知--中央民族大学丰台校区就医管理办法（暂行）`

固定判断：

- 这类文档不是稳定正式规章 owner
- 它们的核心 retrieval 维度是：
  - effective window
  - campus/site
  - transition state

其中 `191705` 的关键点是：

- 继续排除，不是因为标题含 `暂行`
- 真正决定性信号来自正文：
  - `临时医疗点`
  - `校医院正式运营前`
  - `正式运营后取消`

当前默认 query policy：

- `include_with_warning`

## 为什么现在改成新增统一 holding collection

当前 repo 改为新增统一 holding collection `regulations/scoped_rules`，原因有三条：

1. 这批文本已经完成 source-side adjudication，不应继续停在 `manual_review_required`。
2. 当前目标是尽快 import canonical text，而不是立即开放 query-serving。
3. 一个统一 holding collection 比继续拆成多个 bucket-specific collection 更符合当前阶段。

## 外部资料如何影响这个判断

### Azure AI Search

官方文档把 freshness 建模为 ranking function，而不是 validity truth：

- https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles

官方文档还要求 filterable fields 显式进入 schema：

- https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index

对本项目的直接含义：

- `year`
- `program`
- `effective_date`
- `campus_site`
- `force_status`

这些都应先被视作 future surface 的 metadata/query-policy 约束，而不是先倒推出“应该建哪个 collection”。

### Qdrant

Qdrant 官方文档建议：

- 大多数情况下优先单 collection + payload partitioning
- 只有确实需要隔离时再拆多 collection

参考：

- https://qdrant.tech/documentation/guides/multitenancy/

对本项目的直接含义：

- 当前阶段先用一个统一 `scoped_rules` holding collection 承接 canonical text，比继续细分多个下游 collection 更稳

## 当前可执行结论

- `institutional_regulations` 继续只收稳定正式规章正文
- `annual_cycle_rule` 与 `time_bound_operational_rule` 现在应进入 `regulations/scoped_rules`
- `scoped_rules` 当前固定保持 `offline_preparation + query_disabled`
- 后续如果要开放 query-serving，再单独冻结：
  - query policy
  - product entry
  - metadata fields
