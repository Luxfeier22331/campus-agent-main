---
doc_type: index
truth_scope: data
owner_boundary: docs/data
status: active
created: 2026-04-12
updated: 2026-06-13
---
# Data

`data/` 保存逻辑 schema、ownership 与数据面边界。它回答“谁拥有哪张表/哪类事实”“哪些字段是
canonical truth”“哪些只是 projection carrier”。

## Runtime / App Schema

- `app-api/README.md`
  - `app-api/auth-chat-docs-profile.md`
  - `app-api/runtime.md`
  - `app-api/operator.md`
- `app-api/official-web.md`
- `dining.md`
- `identity-platform.md`
- `durable-runtime.md`
- `document-reader.md`

## Source-Channel Source-Truth Schema

- `official-web.md`
- `authenticated-notice.md`
- `campus-services-ops.md`
- `wechat-official.md`

班车时刻表能力的人类 source/update/storage truth 已收口到
`../domains/transport.md`；机器 schema 仍由 `../../packages/contracts/schemas/`
承接。

## Navigation / Entity Data

- `place-catalog.md`

## Retrieval Activity / Evidence Data

- `retrieval-activity.md`

## Infra Ownership

- `postgres-ownership.md`

## 使用规则

- schema 文档描述逻辑 ownership，不替代 migration 历史
- canonical source-truth artifact/schema 放在这里，不伪装成 architecture 或 runtime seam
- panel、runbook、reference 若引用数据真相，应优先回链到这里
- schema 文档可以说明“当前已冻结的逻辑表/字段子集”，但不承担 `.planning` 中的 active lane /
  pending work / closeout 状态说明
