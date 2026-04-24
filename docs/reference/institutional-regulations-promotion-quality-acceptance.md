---
doc_type: reference
status: active
created: 2026-04-11
updated: 2026-04-24
---
# Institutional Regulations Promotion Quality Acceptance

## 文档边界

本文冻结 `campus_notices/internal_notice -> regulations/institutional_rules`
promotion/materialization 的 acceptance truth。

它回答的是：

- target identity 应如何定义
- duplicate notice provenance 应如何保留
- 当前 materialization 到哪里为止才算通过

它不回答：

- offline inventory bucket 划分
- auth-blocked owner recovery 执行状态
- target-side operator 命令细节

相关文档：

- `docs/reference/institutional-regulations-offline-inventory.md`
- `docs/runbooks/internal-notice-policy-regulation-promotion-runbook.md`
- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md
  `
- `docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md`

## Scope Boundary

当前 acceptance 只覆盖：

- institution-wide stable regulation target
- promotion -> target materialization -> target registry refresh 的通过条件

它不覆盖：

- `scoped_rules` 的 query contract
- chunk preparation 之后的 release / alias publish
- auth-window `file_release` owner recovery

## Acceptance Truth

### 1. Target identity 不得从 `notice_id` 派生

固定要求：

- target `document_id` 必须由 `regulation_work_title + issuing_org + semantic
  scope` 派生
- `notice_id` 只保留在 provenance metadata

### 2. Title / version metadata 必须显式分层

当前 acceptance 固定保留：

- `regulation_work_title`
- `regulation_edition_label`
- `regulation_display_title`
- `source_title_literal`
- `regulation_title_normalized`

固定要求：

- `regulation_display_title` 保留完整 edition 语义
- 裸年份不替代完整 `edition_label`
- title/version contract 的长期设计以上游 ADR 为准，不能在 acceptance 文档中私自扩写

### 3. Duplicate notice 只能保留一个 promoted canonical document

固定要求：

- 同一制度正文跨多个 notice 命中 duplicate/same-content 时，只保留一个 promoted target document
- duplicate notice provenance 必须聚合进 target metadata

当前聚合字段至少包括：

- `source_notice_ids`
- `source_notice_document_ids`
- `source_document_ids`
- `source_parent_document_ids`
- `source_attachment_document_ids`
- `source_attachment_ref_ids`
- `source_attachment_sha256s`
- `semantic_owner_document_ids`
- `duplicate_source_document_ids`

### 4. Provenance 必须区分 notice 层和 owner 文档层

固定要求：

- promoted regulation metadata 必须显式区分：
  - `source_notice_document_id`
  - `semantic_owner_document_id`
- attachment-backed regulation 中，这两个字段不得相同
- notice-body regulation 中，两者可以相同

### 5. Materialization 当前必须 stop 在 `offline_preparation`

通过条件：

- canonical markdown 已生成
- target document-units 已生成
- target registry scope 已被 scope refresh 替换
- `internal_notice` source scope 未被改写

当前不属于通过条件：

- target chunk preparation
- embedding / Qdrant write
- release / alias publish

当前 Phase 8 closeout 已补充 target-side chunk preparation 的 local-only
acceptance evidence，但 stop point 仍未提升到 release / alias publish。冻结证据见：

- `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-08-acceptance-freeze/`

### 6. Repo-local acceptance 必须使用隔离 snapshot root

固定要求：

- local-only materialization 验收时，target registry/object-store 输出必须落到隔离目录
- 不得把长期 source snapshot 输出根直接当 target 输出根

### 7. Parent wrapper notice 只能提升独立正文

固定要求：

- wrapper 行必须在 target canonical markdown 前导中被去除
- `关于发布/印发/修订...的通知` 不得残留为 target title 或正文前导
- body citation 与 body heading 不能充当 formal regulation admission evidence

### 8. Source scope refresh 与 target scope refresh 必须分离

固定要求：

- `internal_notice` 保留 source / triage truth
- `institutional_rules` 单独做 target scope refresh
- source row 不能通过“改名”直接冒充 target row

## Relationship With Other Targets

- annual / time-bound scoped rules 已转入 `regulations/scoped_rules`
- 它们不再构成 `institutional_rules` acceptance scope
- `institutional_rules` acceptance 只面向 institution-wide stable regulation

## Verification Expectations

当前这条线的 repo verification 至少应持续覆盖：

- promotion manifest build
- target materialization worker
- duplicate provenance aggregation
- wrapper stripping
- title/version metadata retention
- parent-body false-positive guard

## Usage Rule

- 需要看当前 target bucket 与 blocked frontier，读
  `institutional-regulations-offline-inventory.md`
- 需要看 target quality acceptance 与 identity rules，读本文
- 需要看 operator path，读对应 runbook
