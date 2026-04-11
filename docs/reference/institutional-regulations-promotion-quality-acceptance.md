---
doc_type: reference
status: active
created: 2026-04-11
updated: 2026-04-11
---

# Institutional Regulations Promotion Quality Acceptance

## 文档边界

本文记录 `campus_notices/internal_notice -> regulations/institutional_regulations` 这条 promotion/materialization 线当前已经冻结的质量真相。

它回答的是：

- promoted target document 的 identity 应该如何定义
- duplicate notice 应如何保留 provenance
- 当前 materialization 到哪里为止才算通过

它不回答：

- target collection 什么时候进入 chunk preparation
- target collection 什么时候进入 release / alias publish

## 当前 acceptance truth

### 1. Target identity 不得从 `notice_id` 派生

固定要求：

- target `document_id` 必须由 `regulation_title_normalized + issuing_org + semantic scope` 派生
- `notice_id` 只能存在于 provenance metadata，不得作为 target 主身份

### 2. Duplicate notice 只能保留一个 promoted canonical document

固定要求：

- 同一制度正文跨多个 notice 命中 duplicate/same-content 时，只保留一个 promoted target document
- duplicate notice 的 provenance 必须聚合进 target metadata，而不是静默丢失

当前聚合字段：

- `source_notice_ids`
- `source_document_ids`
- `source_parent_document_ids`
- `source_attachment_ref_ids`
- `source_attachment_sha256s`
- `duplicate_source_document_ids`

### 3. Target materialization 当前必须 stop 在 `offline_preparation`

通过条件：

- canonical markdown 已生成
- target document-units 已生成
- target registry scope 已被 scope refresh 替换
- `internal_notice` source scope 未被改写

当前仍不属于通过条件的内容：

- target chunk preparation
- embedding / Qdrant write
- release / alias publish

### 4. Parent wrapper notice 只能提升独立正文

固定要求：

- parent-body candidate 必须去掉 wrapper 语义后再进入 target canonical markdown
- `关于发布/印发/修订...的通知` 这类 wrapper 行不得残留为 target 标题或 target 正文前导

### 5. Source scope refresh 与 target scope refresh 必须分离

固定要求：

- `internal_notice` 保留 source/triage truth
- `institutional_regulations` 单独做 target scope refresh
- 不能把 source row 直接“改名”成 target row

## 当前 repo 级验证面

当前这条线的 repo verification 固定至少覆盖：

- `tests.ingestion.test_internal_notice_regulation_promotion`
- `tests.ingestion.test_build_internal_notice_regulation_promotion_manifest_worker`
- `tests.ingestion.test_internal_notice_regulation_materialization`
- `tests.ingestion.test_materialize_internal_notice_regulation_worker`

这些测试当前锁住的事实包括：

- duplicate provenance 聚合
- target scope refresh 替换旧 target rows
- target canonical markdown 去 wrapper
- worker CLI 的 request/filter 传递
