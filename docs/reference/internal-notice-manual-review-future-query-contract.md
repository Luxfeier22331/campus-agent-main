---
doc_type: reference
status: active
created: 2026-04-11
updated: 2026-04-11
---

# Internal Notice Manual-Review Future Query Contract

## 文档边界

本文冻结 `annual_cycle_rule` 与 `time_bound_operational_rule` 在未来如果重开 dedicated semantic-owner surface 时，必须先满足的 query contract。

它回答的是：

- 未来 reopen 前必须先准备哪些 metadata / filter projection
- 这两类文档允许哪些 query mode 与 retrieval intent
- 哪些 year / site / temporal 约束必须在 retrieval 前显式化
- `current / historical / as_of / compare` 在这两类文档上的真实含义是什么

它不回答：

- `regulations/scoped_rules` 的具体 materialization 实现细节
- 未来 query-serving reopen 的最终产品入口
- 当前 merged truth 已经开放对应 query-serving surface

## 当前冻结前提

当前 repo truth 现在是：

- `annual_cycle_rule` 与 `time_bound_operational_rule` 不进入 `regulations/institutional_rules`
- `regulations/scoped_rules` 已作为统一 holding collection 被 repo 跟踪
- 当前 query-enabled surface 仍只有 `regulations/student_rules` 与 `curriculum/curriculum_plan`
- `scoped_rules` 当前只是 `offline_preparation` scaffold，不等于已开放 query-serving

这意味着：

- 本文冻结的是 future query-serving reopen contract，不是当前 import gate
- 当前 import-first 路线以 `regulations/scoped_rules` 为准
- 如果产品侧没有明确 reopen admissions / operations 相关 slice，本文不会单独授权新 query surface 出现

## Shared Reopen Contract

未来如果要重开这两类文档，必须同时满足三件事：

1. 明确 semantic owner 与 product entry。
2. 明确 query policy 与 query-planning contract。
3. 明确 retrieval pre-filter 所需的 metadata projection。

三者缺一不可。

固定禁止：

- 先建 collection，再让 query 层事后猜 year / site / transition
- 让 retrieval backend 靠 freshness 或 embedding 相似度替代 validity/temporal 选择
- 把历史 / 时限型规则混进 `institutional_rules`

## Shared Metadata Contract

未来 surface 一旦创建，至少要有以下 filter projection 字段：

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

其中：

- `published_at` 用于排序、解释和 compare，不单独表示 validity
- `effective_from/effective_to` 用于 temporal filter，不得在回答后补救
- `visibility_*` / `entitlement_*` 继续只是 authz filter projection，不是 canonical authz truth

## Bucket A: `annual_cycle_rule`

### 适用文档

- 年度 / 批次 / 项目制招生实施细则
- 推免、硕博连读、英才计划等 program-specific rules

### 必备 metadata

- `cycle_year`
- `cycle_label`
- `admission_route`
- `program_name`
- `degree_level`
- `school_unit_name`

如果缺少 `cycle_year`、`admission_route` 或 `school_unit_name` 这类核心字段，则不允许打开 query-serving。

### 默认 query policy

- 默认策略固定为 `explicit_year_only`

这表示：

- 用户没给出年份或明确当前届次时，不能静默取“最新一版”
- 用户只问“保研细则”“硕博连读实施细则”这类问题时，必须先澄清 year 与 school unit / program
- 排序层可以在已约束的候选集合内部使用时间信号，但不能替代 year filter

### 允许的 query mode

- `current`
  - 只有在 year 已被显式解析后才成立，例如 `2026届推免细则`、`今年英才计划硕博连读`
- `historical`
  - 允许，但必须显式 year
- `as_of`
  - 只有在 future surface 真正建模了 cycle 生效边界时才成立；否则应规范化回 `explicit_year_only`
- `compare`
  - 允许，但必须是同一 `rule_family + school_unit + program/admission_route` 下的显式跨年比较

### 必须先澄清的歧义

- year 未出现
- 同一 year 下存在多个学院或项目
- 标题只出现泛词，例如 `实施细则`、`推免政策`

固定禁止：

- 用发布时间最新替代 `cycle_year`
- 把跨学院、跨项目的规则直接混检后交给回答层挑一个

## Bucket B: `time_bound_operational_rule`

### 适用文档

- 假期、开学前后、窗口期运营规则
- 正文带显式临时 / 过渡 / 取消条件的运营规则

### 必备 metadata

- `effective_from`
- `effective_to`
- `campus_site`
- `operational_domain`
- `transition_state`
- `sunset_condition`

如果缺少有效时间窗或 site 约束，不允许打开 query-serving。

### 默认 query policy

- 默认策略固定为 `include_with_warning`

这表示：

- 命中结果时必须显式展示有效时间窗和当前状态
- 如果规则已经过期、尚未生效、或正文包含明确 transition/sunset 语义，回答必须明确标注，而不是伪装成稳定长期规定
- 如果用户没有给日期、窗口或校区，而候选存在多条时限规则，必须先澄清

### 允许的 query mode

- `current`
  - 只有在当前日期或用户指定日期能落入有效窗口时才成立
- `historical`
  - 允许，但必须显式 date/window/site
- `as_of`
  - 是这类文档的核心模式；版本/窗口选择必须发生在 retrieval 前
- `compare`
  - 只允许同一 `campus_site + operational_domain` 下的跨窗口或前后过渡比较

### 必须先澄清的歧义

- 校区未给出，但文档按 `campus_site` 分化
- 用户问“现在怎么就医/怎么进实验室”，但当前索引里只存在历史窗口规则
- 正文出现 `正式运营前`、`正式运营后取消` 这类 transition 条件，而当前问题没有给出时间点

固定禁止：

- 把过期窗口规则静默当成当前规则
- 把 `暂行/试行` 单独当作 exclusion 或 current 依据

## `current / historical / as_of / compare` 的统一解释

对这两类 future surface，统一解释固定为：

- `current`
  - 必须是已解析的 current cycle 或当前有效时间窗，不允许“默认猜最新”
- `historical`
  - 必须是显式历史 year/date/window
- `as_of`
  - 必须在 retrieval 前落成 filter，不允许先全取再事后说明
- `compare`
  - 必须先锁定可比范围，再进入 retrieval

如果 query planner 做不到上述约束，则未来 surface 仍应保持 `offline_preparation`。

## Reopen Acceptance Checklist

未来如果要把这两类文档从 `scoped_rules/offline_preparation` 继续推进到 query-serving，至少要补齐：

1. 明确的 product entry 与 semantic-owner 定义。
2. surface 级 `query-planning.json`，包含 clarification cues 与允许的 deictic 解析范围。
3. filterable/facetable metadata projection 设计。
4. 对 `current / historical / as_of / compare` 的 retrieval pre-filter 规则。
5. answer 层 warning / status 展示规则。
6. 覆盖歧义 year、site、transition、expired-window 的 eval cases。
7. provenance 保留：
   - `source_notice_ids`
   - `source_attachment_ref_id`
   - `source_notice_release_time`

## 外部资料如何支持这个结论

以下是文档事实与基于文档的推断：

- Azure AI Search 官方文档要求过滤字段显式声明为 filterable，并支持在向量检索前后执行 filter。
  - https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index
  - https://learn.microsoft.com/en-us/azure/search/vector-search-filters
- Azure AI Search 官方文档把 freshness 建模为 scoring function，而不是 validity truth。
  - https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles
- Qdrant 官方文档把 payload filter / facet 视为一等能力，并建议大多数多租户场景优先单 collection + payload partitioning。
  - https://qdrant.tech/documentation/concepts/payload/
  - https://qdrant.tech/documentation/guides/multitenancy/

基于这些资料的推断是：

- 这两类 future surface 的第一优先级应是 metadata/query contract，而不是仓促定 collection 名
- 在 query contract 还没冻结前，不应把 year/site/time-window 这类关键约束留给回答层事后修补

## Related Docs

- `docs/architecture/retrieval-serving-architecture.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`
- `docs/decisions/adr-0036-notice-derived-non-regulation-rule-boundary.md`
- `docs/reference/internal-notice-manual-review-collection-strategy.md`
