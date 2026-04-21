---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-22
---

# Plans

`docs/plans/` 现在是 archive-only namespace。
当前 active / deferred / backlog workstreams 与其状态以 `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`
和 `.planning/workstreams/<slug>/README.md` 为准；这里不再承载前向 workstream 入口。

## Archive Namespaces

- `archive/completed/`
  - 已完成 workstream / foundation 的 closeout 说明与 reopen rule
- `archive/historical/`
  - 历史阶段、旧 backlog 与仍保留参考价值但不再前向消费的计划
- `archive/superseded/`
  - 被原生 GSD workstream 或更新方案替代的旧链路文档

## Current Workflow Entry

- repo 级当前 workstream registry：
  - [../.planning/WORKSTREAMS.md](../.planning/WORKSTREAMS.md)
- 单条 workstream 的 live 入口：
  - [../.planning/workstreams/](../.planning/workstreams/)
- 本目录只负责 archive 导航，不再声明 active/deferred/backlog workstream 入口

## 使用规则

- 不要再把 `docs/plans/*.md` 当作当前 active workstream 的 canonical entry
- 当前可执行 workstream 一律从 `.planning/WORKSTREAMS.md` 和 `.planning/workstreams/<slug>/README.md` 恢复
- 需要 completed/historical/superseded 叙事时，再回到本 namespace
