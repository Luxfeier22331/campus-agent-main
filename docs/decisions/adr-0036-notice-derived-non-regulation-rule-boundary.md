---
doc_type: decision
decision_id: ADR-0036
status: accepted
created: 2026-04-11
updated: 2026-04-28
---
# ADR-0036 Notice-Derived Non-Regulation Rule Boundary

## 状态

Accepted on 2026-04-11.

## 背景

`authenticated_notice_portal -> campus_notices/internal_notice -> regulation
promotion` 这条线在 2026-04-11 已经冻结出一批明确不应进入 `regulations/institutional_rules` 的文档：

- 年度 / 项目制招生实施细则
- 假期期间运营规则
- 正文带显式过渡 / sunset 语义的临时运营规则

同时，这一轮 repo-local adjudication 也纠正了两个错误简化：

- 校内制度文本不因发布时间老旧自动降权或排除
- `暂行/试行` 不自动等价于草案、失效或 manual-only

因此，当前真正需要冻结的不是“再把这些文档硬塞进哪个 collection”，而是：

- 它们为什么不能进入 `regulations/institutional_rules`
- 它们在 dedicated semantic-owner surface 尚未存在前应停在哪一层
- 未来如果要开放新的 collection，应满足什么条件

## 决策

### 决策 1：`annual_cycle_rule` 与 `time_bound_operational_rule` 不进入 `regulations/institutional_rules`

以下 document nature 固定排除在 `regulations/institutional_rules` 之外：

- `annual_cycle_rule`
  - 年度、批次、项目制、学院制招生/推免/硕博连读/英才计划规则
- `time_bound_operational_rule`
  - 假期窗口规则
  - 正文含显式临时/过渡/取消条件的运营规则

原因：

- 这两类文本不是长期稳定 institution-wide regulation owner
- 它们的正确 query policy 与稳定规章正文不同

### 决策 2：这些文本在 dedicated semantic-owner surface 出现前，继续停留在 `campus_notices/internal_notice`

在新的 semantic-owner collection 明确之前，当前 canonical truth 固定为：

- wrapper notice、机器处理 pending/terminal outcome、relation truth 继续留在
  `campus_notices/internal_notice`
- 旧人工复核 / 延后复核标记不再作为 current consumption state 生成；
  owner surface 尚未开放时，必须进入明确 target surface、pending multimodal recovery、
  `no_adoption` 或 fail-closed retained notice card
- 这类文档当前不进入 `regulations/*`

### 决策 3：没有明确产品 slice、query policy 与 owner 之前，不新增 repo-tracked collection scaffold

当前不新增新的 `runtime-profile.json` / collection scaffold，只为这些 manual buckets 提前占位。

原因：

- repo 当前还没有 admissions/operator-facing agent 或对应 query-serving surface
- 当前 merged truth 里不存在与这两类文档对应的产品入口
- 在无明确 owner 的情况下新增 collection scaffold，会把“未来可能的 collection 名”误写成当前架构真相

### 决策 4：未来如果开放 dedicated surface，query policy 必须与 document nature 一起冻结

未来若重新开放这两类文档，至少要同步冻结：

- `annual_cycle_rule`
  - 必须支持显式 year/program/school-unit 约束
  - 默认 query policy 应是 `explicit_year_only`
- `time_bound_operational_rule`
  - 必须支持 effective-window / campus-site / transition-state 约束
  - 默认 query policy 应是 `include_with_warning` 或等价显式 temporal policy

固定禁止：

- 把“老文档”当作 validity truth
- 把 `暂行/试行` 当作 automatic exclusion signal
- 在没有 dedicated query policy 的前提下直接打开 query-serving

### 决策 5：`provisional_in_force` 是 metadata truth，不是 collection membership truth

对 `暂行/试行` 文本，repo 允许保留如下 metadata 判断：

- `force_status = provisional_in_force`

但这不直接决定：

- 是否进入 `institutional_rules`
- 是否只能 manual-review

真正决定 collection membership 的仍然是：

- document nature
- wrapper semantics
- body-level temporary / annual-cycle signals

## 结果

直接结果如下：

- `regulations/institutional_rules` 的边界进一步明确为“稳定正式规章正文”
- `internal_notice` 不再用旧人工复核 / 延后复核标记表示未决分类；
  未开放 owner 的文本必须通过明确机器可解释状态 fail closed
- 未来如果要消费招生实施细则或运营规则，必须先定义 dedicated semantic-owner surface 和 query
  policy，而不是反向污染 `regulations/*`

## Supporting Rationale

- Azure AI Search 官方文档把 freshness 建模为 ranking/function metadata，而不是 validity
  truth：
  - <https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles>
- Azure AI Search 官方文档要求 filterable fields 显式进入 schema：
  - <https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index>
- Qdrant 官方文档建议默认优先单 collection + payload partitioning，只有在确实需要隔离时再拆多个
  collections：
  - <https://qdrant.tech/documentation/guides/multitenancy/>

这些外部资料支持的推断是：

- 在 dedicated semantic-owner surface 尚未打开前，把这类文档继续留在 source-triage
  collection，并通过 metadata / query policy 约束其 future routing，比仓促新增 collection 更稳

## Related Docs

- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`
- `docs/reference/internal-notice-manual-review-collection-strategy.md`
- `.planning/quick/260411-rho-institutional-regulations-promotion-adju/manual-re
  view-adjudication.md`
