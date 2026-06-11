---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-06-04
---
# Data

`data/` 保存逻辑 schema、ownership 与数据面边界。它回答“谁拥有哪张表/哪类事实”“哪些字段是
canonical truth”“哪些只是 projection carrier”。

## Runtime / App Schema

- `app-api-schema.md`
- `app-api-official-web-schema.md`
- `durable-agent-runtime-schema.md`
- `canonical-document-reader-model.md`

## Source-Channel Source-Truth Schema

- `official-web-source-truth-schema.md`
- `authenticated-notice-source-truth-schema.md`
- `campus-services-ops-source-truth-schema.md`
- `campus-services-transport-schedule-source-truth-schema.md`
- `campus-services-service-guide-source-truth-schema.md`
- `campus-services-contact-directory-source-truth-schema.md`
- `campus-services-service-catalog-source-truth-schema.md`
- `wechat-official-account-source-truth-schema.md`

## Navigation / Entity Data

- `campus-navigation-place-catalog.md`

## Retrieval Activity / Evidence Data

- `retrieval-query-activity-model.md`

## Infra Ownership

- `shared-postgres-ownership.md`

## 使用规则

- schema 文档描述逻辑 ownership，不替代 migration 历史
- canonical source-truth artifact/schema 放在这里，不伪装成 architecture 或 runtime seam
- panel、runbook、reference 若引用数据真相，应优先回链到这里
- schema 文档可以说明“当前已冻结的逻辑表/字段子集”，但不承担 `.planning` 中的 active lane /
  pending work / closeout 状态说明
