---
doc_type: reference
status: active
created: 2026-04-06
updated: 2026-04-21
---
# Internal Notice Offline Preparation Strategy

## 文档边界

本文冻结 `campus_notices/internal_notice` 在

`source-truth replay -> document build -> split / cleanup / chunk -> verified
chunk preparation`

这一段的 collection-specific strategy。

它负责：

- collection semantic boundary
- notice-family / notice-risk 的策略语义
- parent/child lane model
- chunk preparation 与后续 release 的边界

它不负责：

- operator 执行步骤
- auth-window donor / capture 细节
- regulation target materialization 实施顺序

相关文档：

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`

## Collection Posture

当前 collection posture 固定为：

- `source_channel=authenticated_notice_portal`
- `corpus/collection=campus_notices/internal_notice`
- `serving_stage=offline_preparation`
- `retrieval_enabled=false`
- `query_enabled_by_default=false`
- `restricted institutional document` rollout

固定解释：

- `internal_notice` 是 source-channel-first triage collection
- 它不是 formal regulation collection
- verified replay / chunk preparation 只证明 source-channel triage 质量，不等于
  regulation corpus 已成立
- future notice runtime 如需消费 `internal_notice`，也只能把它当作 restricted notice source
  family；这不自动打开 query-serving，也不把它改写成 public notice surface
- future restricted notice runtime query seam 只能读取 projected notice metadata /
  canonical body truth
- query path 不得直接扫描 `internal_notice` raw/source-truth bundle、chunk preparation
  artifacts 或 query-disabled retrieval alias

## Notice-Family Admission Contract

`internal_notice` 允许维护独立于 attachment risk 的 notice-family admission。

这层分类只属于：

- inventory / replay / operator read model
- batch planning / pilot sampling
- 处理顺序收口

它不属于：

- source-truth contract
- attachment typed routing
- parent / child document identity

固定要求：

- family truth 继续由 repo-tracked config 与 inventory owner 持有
- replay / preparation priority 可以按 family 控制
- 具体优先级与 frontier 变化不在本文落日期状态，统一回到 config、inventory 与 `.planning`

## Notice Risk Profile Contract

`internal_notice` 允许维护 notice-level risk profile，但它只属于 inventory / replay /
operator read model。

当前稳定字段包括：

- `notice_risk_label`
- `attachment_mix_score`
- `has_text_table_attachment`
- `has_spatial_attachment`
- `has_reference_only_attachment`

当前标签集固定为：

- `body_only`
- `body_with_reference_only_attachments`
- `body_with_text_attachments`
- `body_with_spatial_attachments`
- `mixed_high_risk`

固定要求：

- validator / sample export 优先读取 frozen inventory
- 不允许只根据当前 materialized document 重新猜 risk profile
- `manual_review_required` 与 `reference_only` attachment 不因“没有 child document”而从
  risk profile 中消失

## Accepted Lane Model

`internal_notice` 的离线 preparation 固定按三类 document lane + terminal outcomes 处理：

- `notice_body`
- `attachment_text_extractable`
- `attachment_ocr_required`
- terminal outcomes:
  - `reference_only`
  - `manual_review_required`
  - `no_extractable_text`
  - `unsupported_binary`

这些 lane / outcomes 都建立在两层 projection 上：

- parent notice document 只承载 notice 正文
- attachment refs 留在 source-truth relation truth
- attachments 如需进入 document/chunk pipeline，必须先 materialize 成 repo-owned child
  documents

## Parent Notice Lane

固定规则：

- 只消费 notice 正文结构单元
- `attachment_ref` 结构单元必须显式跳过
- 默认按正文结构做 `structure-first` 聚合
- attachment OCR / 表格 / 装饰资源问题不得反向驱动 parent lane 全局降级

## Attachment Text-Extractable Lane

固定规则：

- 先完成确定性的 native text extraction，再进入 cleanup / chunk
- chunking 以 attachment 自身结构为准
- 不把 attachment 文本重新拼回 parent notice 正文 chunk
- 当前只覆盖 canonical accepted 的 Office / text-extractable family

## Attachment OCR Lane

固定规则：

- `pdf` 默认按 `ocr_required` 处理，不因 text layer 自动回到 text-extractable lane
- OCR lane 的 provider routing 由 shared OCR owner 决定，不由本 collection 文档重新定义
- `manual_review_required` / `reference_only` 继续作为 terminal outcome，而不是 OCR lane
  失败后的隐式补救

## Preparation / Release Boundary

固定要求：

- `chunk preparation` 与 `index release` 必须继续分离
- verified preparation 只证明：
  - canonical markdown
  - document-units
  - chunk artifacts
  - preparation validation
- verified preparation 不自动推出：
  - embedding
  - Qdrant write
  - release / alias publish

## Related Docs

- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/reference/internal-notice-manual-review-collection-strategy.md`
