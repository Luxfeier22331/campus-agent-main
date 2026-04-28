---
doc_type: decision
decision_id: ADR-0035
status: accepted
created: 2026-04-10
updated: 2026-04-28
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
- 是否与既有 regulation 文本重复
- provenance 是否足够回链到原始 notice / attachment

### 决策 4：wrapper notice 必须继续留在 `internal_notice`

即使某条 notice 的附件或正文最终被提升为 formal regulation：

- 原始 wrapper notice 仍继续留在 `campus_notices/internal_notice`
- promoted regulation 必须显式保留 `source_notice_ids`、`source_attachment_ref_id` 等
  provenance
- regulation identity / version 不得继续用 `notice_id` 充当长期主身份

### 决策 5：repo-tracked target collection 固定为 `regulations/institutional_rules`

对这条 source-channel 的第一条 notice-derived regulation target，repo 级命名固定为：

- `regulations/institutional_rules`

原因：

- 它表达的是机构正式制度正文的语义 owner
- 它不绑定单一 source channel
- 后续如果同一制度正文来自 `official_web` 或其他 canonical source，仍可进入同一 collection

当前这条 target collection 的 forward posture 固定为：

- `serving_stage=offline_preparation`
- `query_enabled=false`

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
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`
- `docs/decisions/adr-0024-authenticated-notice-source-channel.md`
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spa
  tial-review-boundary.md`
- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md
  `
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
