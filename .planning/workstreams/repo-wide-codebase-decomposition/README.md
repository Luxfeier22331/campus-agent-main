---
doc_type: index
status: completed
created: 2026-04-22
updated: 2026-04-27
---

# Workstream: Repo-wide Codebase Decomposition

这是 `repo-wide-codebase-decomposition` 的 native workstream 入口。
它只承接 repo 级 handwritten code/test monolith decomposition，不接受功能扩 scope 或边界重写伪装成 cleanup。

## Current Status

- status: `completed`
- current phase: `Phase 10` complete
- current focus: reopened regression inventory 已清零；19 个 admitted
  handwritten code/test files 均已完成 facade/support/suite/runtime split 并降到
  `800` 行阈值内。
- governance gate: `configs/lint/decomposition-baseline.json` 已清空；`pnpm
  decomposition:lint` 继续作为 canonical fail-close gate，阻止新增超阈值 tracked
  handwritten code/test file、baseline 回流或 resolved 文件滞留。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- superseded plan snapshot: `../../../docs/plans/archive/superseded/repo-wide-codebase-decomposition.md`
