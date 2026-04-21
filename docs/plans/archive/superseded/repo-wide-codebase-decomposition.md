---
doc_type: plan
status: superseded
created: 2026-04-21
updated: 2026-04-22
---

# Repo-wide Codebase Decomposition

## Boundary

这条 workstream 专门承接 repo 级“大文件拆分”技术债。
它只处理 hand-written code/test decomposition，不负责功能扩 scope，也不接管 vendor、lockfile、Drizzle snapshot 或其它 generated artifacts。

## Native Planning Truth

- requirements:
  - `.planning/workstreams/repo-wide-codebase-decomposition/README.md`
- roadmap:
  - `.planning/workstreams/repo-wide-codebase-decomposition/ROADMAP.md`
- state:
  - `.planning/workstreams/repo-wide-codebase-decomposition/STATE.md`

## Scope Summary

- inventory 已冻结为 repo 当前所有 handwritten `800+` code/test files，加上少量已显式 admission 的 sub-800 multi-owner monolith files
- phases 按 `ingestion-core`、`retrieval/evals`、`app surfaces`、`collector`、`repo tests` 分 tranche
- 所有 tranche 都要求：
  - 行为不变
  - 导出契约稳定或显式迁移
  - targeted regression + relevant full-lane verification
