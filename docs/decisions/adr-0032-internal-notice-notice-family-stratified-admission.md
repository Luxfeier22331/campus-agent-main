---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0032
status: accepted
created: 2026-04-09
updated: 2026-07-08
---
# ADR-0032 Internal Notice Notice-Family Stratified Admission

## 状态

Accepted on 2026-04-09.

## 命名说明

本文中的 `authenticated_notice_portal` 是历史 source channel 名称。当前 active source
channel 名称是 `internal_portal`；本文继续冻结 `campus_notices/internal_notice`
的 notice-family admission 边界。

## 背景

`authenticated_notice_portal -> campus_notices/internal_notice` 目前已经确认两类事实：

- source-truth 必须尽量完整保留 notice 正文、分类、链接与附件关系
- 真正拖慢 replay / cleanup / OCR 验收节奏的，不只是 attachment 风险，还有 notice 本身的题材混杂

已采集历史样本已经说明，当前门户栏目：

- `办公通知`
- `教学通知`
- `科研通知`
- `学工通知`

都不是稳定的知识域语义分层，而只是 portal 栏目。

同一栏目中会同时混入：

- 规章制度、治理规范、应知应会手册
- 办理流程、申报说明、操作指南
- 名单公示、成绩公示、结果公示
- 活动招募、社会实践、比赛通知
- 讲座预告、论坛宣传

如果继续只按 portal `notice_type` 推进，就会出现两个问题：

- 规章制度类通知无法被稳定优先处理
- 社会实践、讲座预告、活动海报这类低优先级内容会过早占用 replay、OCR 与验收预算

2026-04-09 的 live 登录态抽样进一步确认：

- repo-local collector 当前 tracked 默认只启用 `5 / 办公通知`
- 但 live portal 中 `办公通知`、`教学通知`、`科研通知`、`学工通知` 都明显是混合栏目，不是稳定知识域

## 决策

### 决策 1：`internal_notice` 增加一层 notice-family admission

`internal_notice` 在 source-truth 之上，允许增加一层 collection-specific notice-family
stratification。

这层分类固定属于：

- inventory / replay / operator read model
- local planning / batch admission
- preparation triage

不属于：

- source-truth contract
- notice identity
- attachment typed routing contract

### 决策 2：source-truth 仍保持全量，不在采集层丢 notice

notice-family 分层不能回退成“只抓某一类通知”。

长期规则固定为：

- collector / import / source-truth 尽量保持全量吸收
- downstream replay / preparation admission 才根据 notice-family 做优先级控制

原因：

- 同一条 notice 后续可能服务多个 collection / projection
- portal 栏目与长期知识价值不是一一对应关系
- 现在判断为低优先级的题材，后续仍可能进入别的 agent 或别的人工治理路径

### 决策 3：family 分层主轴不是 portal `notice_type`

portal `notice_type` 只允许作为粗 prior，不允许充当最终 family truth。

当前 accepted shape 固定为：

- 第一层：portal 栏目 / `notice_type` 作为粗过滤 prior
- 第二层：基于 title / body keyword / rule config 做 notice-family 分类

也就是说：

- `notice_type` 可以帮助降低扫描成本
- 但最终 admission 必须由 family 规则决定

### 决策 4：当前优先处理 `policy_regulation`

当前 `internal_notice` 的第一批 priority-now family 固定为：

- `policy_regulation`

典型范围包括：

- 管理办法
- 管理规定
- 实施细则
- 工作规程
- 制度 / 规范 / 条例 / 章程 / 准则
- 应知应会手册
- 稳定办事指南 / 操作指南
- 明确发布、印发、修订正式文件的通知

这类 notice 的共同特点是：

- 长期知识价值更高
- 正文往往更稳定
- 更适合形成 restricted institutional knowledge baseline

### 决策 5：`event_activity` 默认延后

当前默认延后处理的 family 固定包括：

- `event_activity`

典型范围包括：

- 社会实践活动
- 赛事 / 招募 / 邀请函
- 活动预告

这些内容不是永久排除，而是：

- 当前不占用第一批 replay / cleanup / OCR 验收预算
- 如后续需要，可进入单独试点或单独治理批次

### 决策 6：`lecture_publicity` 保留 source-truth，但不属于长期产品消费目标

`lecture_publicity` 当前继续属于 family stratification 的有效分类，但它的长期定位固定为：

- source-truth / inventory / replay triage truth
- operator read model 与 provenance 保留层

它不属于：

- `regulations/*` promotion target
- 默认 RAG / query-serving surface
- authenticated document center 的 planned scope

典型范围包括：

- 讲座预告
- 论坛
- 讲堂
- 读书会

固定规则：

- collector / import / source-truth 继续尽量保留这类 notice 与附件关系
- family tagging 可以继续标记它们为 `lecture_publicity`
- 但 repo 不为这类内容规划 regulation promotion、document-center 承接或 query-facing
  consumption
- 如用户确有查看需求，正确 owner surface 仍是官方门户，而不是 repo 内新增一层镜像产品面

### 决策 7：`roster_publication` 保留 source-truth，但不属于长期产品消费目标

`roster_publication` 当前继续属于 family stratification 的有效分类，但它的长期定位固定为：

- source-truth / inventory / replay triage truth
- operator read model 与 provenance 保留层

它不属于：

- `regulations/*` promotion target
- 默认 RAG / query-serving surface
- authenticated document center 的 planned scope

典型范围包括：

- 名单公示
- 成绩公示
- 结果公示
- 立项名单

固定规则：

- collector / import / source-truth 继续尽量保留这类 notice 与附件关系
- family tagging 可以继续标记它们为 `roster_publication`
- 但 repo 不为这类内容规划 regulation promotion、document-center 承接或 query-facing
  consumption
- 如用户确有查看需求，正确 owner surface 仍是官方门户，而不是 repo 内新增一层镜像产品面

### 决策 8：attachment risk 与 notice family 是两条正交维度

长期上必须显式区分：

- notice family：这条 notice 值不值得现在优先处理
- attachment risk：这条 notice 的 attachment lane 风险有多高

因此固定禁止：

- 用 notice family 替代 attachment typed routing
- 用 attachment risk 替代 notice family admission
- 因 family 被延后，就改写 source-truth contract

## 结果

直接结果如下：

- `internal_notice` 可以先收口一批规章制度类通知，而不需要等待活动类与宣传类通知一起清理完
- `lecture_publicity` 继续保留 source-truth 与 triage truth，但不再被视为后续产品消费候选
- social practice / event notice 不再默认占用当前主处理链路
- `roster_publication` 继续保留 source-truth 与 triage truth，但不再被视为后续产品消费候选
- 后续 replay / pilot / chunk acceptance 可以先围绕 `policy_regulation` 建立更干净的
  restricted baseline
- family stratification 将以 repo-tracked config 和 read-only analyzer
  落地，而不是硬编码在单次脚本里

## Related Docs

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice.md`
- `docs/reference/institutional-rules-promotion.md`
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spa
  tial-review-boundary.md`
- `configs/ingestion/campus_notices/internal_notice/notice-family-classification
  .v1.json`
