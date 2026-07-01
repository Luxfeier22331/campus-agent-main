---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0035
status: accepted
created: 2026-04-10
updated: 2026-05-01
---
# ADR-0035 Notice-Derived Regulation Promotion Boundary

## 状态

Accepted on 2026-04-10.

## 背景

`authenticated_notice_portal -> campus_notices/internal_notice` 这一条
source-channel 现在已经冻结了以下事实：

- source-truth unit 固定为 `notice`
- `internal_notice` 当前姿态固定为 `restricted + offline_preparation`
- parent notice / attachment child document 的两层 projection 已经成立
- attachment typed routing、notice-family admission 与 `pdf -> cloud OCR`
  默认路径都已分别冻结

但 repo 仍缺一条更上层的 collection 语义边界：

- `policy_regulation` notice 被优先处理，不等于 notice 本身就应该成为 regulation corpus 成员
- wrapper notice、发布通知、manual-review outcome、reference-only relation truth 仍然属于
  source-channel triage 层，而不是制度正文本体
- 如果直接把 notice 文档或 notice collection 视为 regulation
  collection，会把“来源包装”和“制度正文”混成一层

这与 repo 里已经存在的更一般约束相冲突：

- source channel、corpus、collection、serving surface 不是同一层
- 正式规章制度应进入有明确语义 owner 的 `regulations/*`
- source-channel collection 可以服务 promotion，但不应冒充最终语义 collection

## 决策

### 决策 1：`campus_notices/internal_notice` 固定为 source-channel-first triage collection

`campus_notices/internal_notice` 的职责固定为：

- 承接 authenticated notice source-truth replay
- 保留 wrapper notice 正文
- 保留 attachment relation truth 与 child-document replay
- 保留 `reference_only`、`pending_multimodal_processing`、`no_extractable_text`、
  `unsupported`、`no_adoption` 等机器可解释 outcome truth
- 承接 restricted rollout 下的 replay / cleanup / chunk preparation / quality
  evidence

它不是：

- formal regulation 的长期语义 owner
- regulation collection 的别名
- notice-derived regulation 的最终承载面

### 决策 2：`regulations/*` 只收 canonical regulation text

`regulations/*` collection 的成员固定只能是可独立消费的正式制度正文或稳定规范性手册正文。

固定禁止写入：

- wrapper notice 文档
- “关于发布/印发/修订某制度的通知”这类包装文本
- `pending_multimodal_processing`、`reference_only`、`no_extractable_text`、
  `unsupported`、`no_adoption` outcome 占位物
- 只表达 source relation 的 attachment refs

### 决策 3：notice-derived regulation 必须跨过显式 promotion boundary

对 authenticated notice source channel，长期正确路径固定为：

`authenticated_notice_portal -> campus_notices/internal_notice -> regulation
promotion -> regulations/*`

固定禁止：

- 从 notice source-truth 直接一跳 fan-out 到 regulation collection
- 把 `internal_notice` document row 直接重标成 regulation row
- 把 source-channel collection 与 semantic-owner collection 混成一个 scope

promotion boundary 至少负责判断：

- 该内容是否已经脱离 wrapper notice 语义
- 该正文是否达到独立消费质量
- 该内容是否仍具备 regulation 文档站收录价值，而不只是历史年度通知或一次性执行细则
- 是否与既有 regulation 文本重复
- provenance 是否足够回链到原始 notice / attachment

### 决策 4：`policy_regulation` signal 不等于 document-site promotion eligibility

`policy_regulation` 只表示 source-channel triage signal。它可以来自标题中的
`办法`、`规定`、`实施细则` 等规则词，但不得直接推出该 notice 应进入
`regulations/*` 或 document reader。

显式 promotion gate 必须继续区分：

- 当前仍可独立消费的 institution-wide regulation text
- 当前仍有产品价值的 scoped rule text
- 明显历史年度周期规则
- 已过期时间窗口 scoped operational rule
- wrapper notice / attachment relation truth / reference-only source

对明显历史年度周期规则或已过期时间窗口 scoped operational rule，默认处理为：

- 保留在 `campus_notices/internal_notice`
- `promotion_disposition=hold_in_internal_notice`
- `recommended_query_surface=notice_level_query`
- 不生成 `regulations/*` target identity
- 不进入 document reader manifest

示例：`甲学院2021年硕博连读博士研究生招生实施细则` 可被识别为
`policy_regulation`，但它绑定 `甲学院 + 2021 + 硕博连读招生` 的历史年度周期，
不应默认进入 regulation 文档站。

示例：`示例生命学院关于2021年暑假期间实验室安全管理规定` 可被识别为
`policy_regulation` 和 scoped operational rule，但它绑定 `2021 + 暑假期间`
的已过期时间窗口，不应默认进入 regulation 文档站。

### 决策 5：wrapper notice 必须继续留在 `internal_notice`

即使某条 notice 的附件或正文最终被提升为 formal regulation：

- 原始 wrapper notice 仍继续留在 `campus_notices/internal_notice`
- promoted regulation 必须显式保留 `source_notice_ids`、`source_attachment_ref_id` 等
  provenance
- regulation identity / version 不得继续用 `notice_id` 充当长期主身份

### 决策 6：repo-tracked target collection 固定为 `regulations/institutional_rules`

对这条 source-channel 的第一条 notice-derived regulation target，repo 级命名固定为：

- `regulations/institutional_rules`

原因：

- 它表达的是机构正式制度正文的语义 owner
- 它不绑定单一 source channel
- 后续如果同一制度正文来自 `official_web` 或其他 canonical source，仍可进入同一 collection

当前这条 target collection 的 forward posture 已在 2026-04-30 Phase 10
从 offline preparation 提升为受控 query-serving：

- `serving_stage=query_serving`
- `retrieval_enabled=true`
- `query_enabled_by_default=true`
- `serving_revision_tracks=["current-effective"]`

这只表示经 selected admission 的 canonical regulation target 可以进入受限
knowledge query path；不表示 wrapper notice、source-channel triage rows 或
online answer citation 被打开。

直到 promotion contract、quality gate、identity/version/provenance 规则都落盘为止，不推进
release/index。

## 结果

直接结果如下：

- `internal_notice` replay / preparation 的通过，不再被误读成 regulation corpus 已成立
- `policy_regulation` 只表达 source-channel triage priority，不直接决定 regulation
  collection membership
- 后续需要单独实现 promotion config、target collection config 与 promotion-quality
  acceptance
- `regulations/*` 的 collection 语义现在已经与 source notice 包装层显式解耦

## Related Docs

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `git history authenticated-notice regulation consumption workstream`
- `docs/decisions/adr-0024-authenticated-notice-source-channel.md`
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md`
  `
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
