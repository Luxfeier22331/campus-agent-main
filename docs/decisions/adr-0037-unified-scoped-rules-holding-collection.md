---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0037
status: accepted
created: 2026-04-11
updated: 2026-05-01
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
- 如果继续把未来 query semantics 当作 import gate，这批文本会继续停在不明确的
  pending/held 状态

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
- `reference_only` / `pending_multimodal_processing` / `no_adoption` attachment
  outcome 占位物
- 稳定 institution-wide regulation 正文
- 明显历史年度周期 notice，例如已经过期的院系年度招生实施细则
- 明显已过期时间窗口 notice，例如已经过期的假期期间实验室安全管理规定

### 决策 2：`regulations/scoped_rules` 是 explicit/internal retrieval-ready collection

当前固定 posture 已在 2026-04-30 Phase 10 更新为：

- `serving_stage=query_serving`
- `retrieval_enabled=true`
- `query_enabled_by_default=false`
- `serving_revision_tracks=["current-effective"]`

这表示：

- 允许先完成 canonical text import
- 允许内部显式 scope 使用 retrieval-ready data-plane
- 默认用户入口仍不把它作为 query-enabled scope
- 不要求当前就落 query-planning / clarification / history semantics

### 决策 3：当前 import 只要求最小 metadata，不把未来 query semantics 当 gate

当前 import 阶段至少保留：

- `document_nature`
- `promotion_disposition`
- `applicability_status`
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

补充约束：

- `annual_cycle_rule` 与 `time_bound_operational_rule` 仍需通过 applicability
  gate 才能进入 scoped-rule target。
- 如果 source text 明确绑定早于当前 processing year 的年度周期或时间窗口，默认
  `promotion_disposition=hold_in_internal_notice`，不进入 `regulations/scoped_rules`
  reader。
- 这类历史年度或历史时间窗口 source 仍可在 `campus_notices/internal_notice`
  作为 notice-level search/query 证据保留。

### 决策 4：详细 query semantics 明确后置

`annual_cycle_rule` 与 `time_bound_operational_rule` 的详细 query policy 仍可继续作为
future guidance 存在，但它们只在 future default-query admission 时生效。

当前明确规则：

- detailed query semantics 不是 `scoped_rules` import gate
- 如果后续要把 `scoped_rules` 推进到默认 query allowlist，再单独冻结
  query-planning / filter policy / eval

### 决策 5：`institutional_rules` 的边界保持不变

本 ADR 不改写以下既有真相：

- `regulations/institutional_rules` 仍只收稳定正式规章正文
- `campus_notices/internal_notice` 仍是 source-triage collection
- wrapper notice 继续留在 `internal_notice`

### 决策 6：manual-review residual 边界收口到 scoped rules

`annual_cycle_rule` 与 `time_bound_operational_rule` 不再留在
`regulations/institutional_rules`，也不继续停在 manual-review residual lane。
它们仍需通过 applicability gate，但 target collection 固定为
`regulations/scoped_rules`。

固定边界：

- duplicate hold 继续保留在 `internal_notice` source layer，只保留 source truth /
  provenance，不生成第二份 regulation target
- 语义正文去重优先于原始 `content_hash` 复制
- parent notice body citation、body heading、`办法 / 意见 / 方案` 等引用词不构成
  formal-regulation admission evidence
- wrapper / operational notice 继续留在 `internal_notice`
- residual frontier 只保留真正缺 owner body 或缺 target metadata 的样本

### 决策 7：默认 query admission 继续后置

`scoped_rules` 可以承接内部显式 retrieval-ready data-plane，但默认用户 query admission
仍然关闭。未来如果要打开默认 query-serving，必须先同时冻结：

- semantic owner 与 product entry
- query policy 与 query-planning contract
- retrieval pre-filter 所需的 metadata projection
- 覆盖 year、site、transition、expired-window 歧义的 eval cases

未来 surface 至少需要这些 filter projection 字段：

- `document_nature`
- `rule_family`
- `published_at`
- `effective_from`
- `effective_to`
- `force_status`
- `school_unit_name`
- `source_notice_ids`
- `source_attachment_ref_id`
- `visibility_level`
- `visibility_scope`
- `entitlement_groups`
- `policy_projection_version`

`annual_cycle_rule` 默认 query policy 是 `explicit_year_only`：用户未给出年份、
届次、school unit 或 program 时，不能静默取“最新一版”。

`time_bound_operational_rule` 默认 query policy 是 `include_with_warning`：命中时
必须保留有效时间窗、site 与当前状态；过期、未生效或 transition/sunset 语义不得伪装成稳定长期规定。

`current / historical / as_of / compare` 必须在 retrieval 前落成可比范围或 filter；
query planner 做不到时，默认 query admission 继续关闭。

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
- `git history authenticated-notice regulation consumption workstream`
