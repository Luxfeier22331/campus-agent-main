---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Data

`data/` 保存逻辑 schema、ownership 与数据面边界。
它回答“谁拥有哪张表/哪类事实”“哪些字段是 canonical truth”“哪些只是 projection carrier”。

## Runtime / app schema

- `app-api-schema.md`
- `app-api-official-web-schema.md`

## Navigation / entity data

- `campus-navigation-place-catalog.md`

## Infra ownership

- `shared-postgres-ownership.md`

## 使用规则

- schema 文档描述逻辑 ownership，不替代 migration 历史
- panel、runbook、reference 若引用数据真相，应优先回链到这里
