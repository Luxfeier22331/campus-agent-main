---
doc_type: decision
decision_id: ADR-0037
status: accepted
created: 2026-04-11
updated: 2026-04-11
---
# ADR-0037 Unified Scoped Rules Holding Collection

## 状态

Accepted on 2026-04-11.

## 背景

前一轮对 `annual_cycle_rule` 与 `time_bound_operational_rule` 的边界拆得过细，虽然把长期 query
policy 风险讲清楚了，但它也暴露出一个当前更实际的问题：

- repo 现在的目标是尽快把这批已完成 source-side adjudication 的规章制度类文本导入下游 semantic-owner
  collection
- 当前还没有足够的数据覆盖、产品入口和文档完备度，去立即定义 `current / historical / as_of / compare`
- 如果继续把未来 query semantics 当作 import gate，这批文本会继续停在 `manual_review_required`

同时，本轮仍保持不变的前提有两条：

- 它们不能进入 `regulations/institutional_rules`
- 它们也不应该继续留在 source-triage 层冒充“只是没看完”

因此需要一个更小、更符合当前阶段的 repo truth：

- 先创建统一的 semantic-owner holding collection
- 先导入 canonical scoped rule text
- 保持 `offline_preparation + query_disabled`
- 详细 query semantics 后置

## 决策

### 决策 1：为这两类文档新增统一 holding collection `regulations/scoped_rules`

repo 新增统一 target collection：

- `regulations/scoped_rules`

它承接：

- `annual_cycle_rule`
- `time_bound_operational_rule`

它不承接：

- wrapper notice
- `reference_only` / `manual_review_required` attachment outcome 占位物
- 稳定 institution-wide regulation 正文

### 决策 2：`regulations/scoped_rules` 是 holding collection，不是 query-serving surface

当前固定 posture：

- `serving_stage=offline_preparation`
- `retrieval_enabled=false`
- `query_enabled_by_default=false`

这表示：

- 允许先完成 canonical text import
- 不要求当前就补齐 admissions / operations 产品入口
- 不要求当前就落 query-planning / clarification / history semantics

### 决策 3：当前 import 只要求最小 metadata，不把未来 query semantics 当 gate

当前 import 阶段至少保留：

- `document_nature`
- `source_notice_ids`
- `source_attachment_ref_id`
- `source_notice_release_time`
- `school_unit_name` 可提则提
- `cycle_year` 可提则提
- `campus_site` 可提则提
- `effective_from` / `effective_to` 可提则提

固定不要求：

- 立即支持 `current / historical / as_of / compare`
- 立即补齐完整 query-planning contract
- 立即补齐所有 year/site/window 的 clarification logic

### 决策 4：详细 query semantics 明确后置

`annual_cycle_rule` 与 `time_bound_operational_rule` 的详细 query policy 仍可继续作为
future guidance 存在，但它们只在 future query-serving reopen 时生效。

当前明确规则：

- detailed query semantics 不是 `scoped_rules` import gate
- 如果后续要把 `scoped_rules` 从 `offline_preparation` 推进到 query-serving，再单独冻结
  query-planning / filter policy / eval

### 决策 5：`institutional_rules` 的边界保持不变

本 ADR 不改写以下既有真相：

- `regulations/institutional_rules` 仍只收稳定正式规章正文
- `campus_notices/internal_notice` 仍是 source-triage collection
- wrapper notice 继续留在 `internal_notice`

## 结果

直接结果如下：

- 这 10 条 manual bucket 文档现在有了可导入的下游 semantic-owner collection
- repo 不再要求“先有完整 query policy 才能 import”
- `regulations/*` 仍保持 source-independent semantic-owner 语义
- 当前下一条工程动作应转为：`scoped_rules` scaffold / materialization / chunk-prep，而不是继续争论
  query mode

## Supporting Rationale

- Azure AI Search 官方文档要求过滤字段显式进入 schema；这支持
  “先保留最小 metadata，再后置 query policy”：
  - <https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index>
- Azure AI Search 官方文档把 freshness 建模为 scoring，而不是 validity truth；这支持当前不把复杂时态判断当
  import gate：
  - <https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles>
- Qdrant 官方文档强调 payload 是一等 metadata/filter 载体；这支持 holding collection 先承接
  canonical text 与基础 metadata：
  - <https://qdrant.tech/documentation/concepts/payload/>
- Qdrant 官方文档建议只有在确实需要隔离时再拆更多 collection；这支持当前先用一个统一 `scoped_rules` holding
  collection，而不是继续分成多个 bucket-specific collections：
  - <https://qdrant.tech/documentation/guides/multitenancy/>

上面的最后一条是基于官方资料的推断：对当前阶段来说，`annual_cycle_rule` 与 `time_bound_operational_rule`
先合流进入一个非查询 holding collection，比继续细分多个下游 collection 更稳。

## Related Docs

- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0036-notice-derived-non-regulation-rule-boundary.md`
- `docs/reference/internal-notice-manual-review-collection-strategy.md`
- `docs/reference/internal-notice-manual-review-future-query-contract.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`
