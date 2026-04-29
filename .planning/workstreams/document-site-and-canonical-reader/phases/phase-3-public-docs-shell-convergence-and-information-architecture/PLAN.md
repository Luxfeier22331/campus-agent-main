---
doc_type: phase_plan
phase: "3"
phase_name: "Public Docs Shell Convergence And Information Architecture"
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 3 Plan

## Objective

把 `public-docs` 收口为基于 Rspress 原生 shell 的长期 docs-first
信息架构：根首页只作为文档站入口，公开正文统一位于
`/docs/:corpus/:collection/:documentSlug`，sidebar、空 scaffold 与
generated-content guard 全部对齐该结构。

## Execution Slices

### Slice 1: Published Reader IA

- 更新 `sync-published-reader-docs`：
  - 生成根 `index.md` 与 `_meta.json`
  - 生成 `/docs/index.md`、`/docs/_meta.json`
  - 生成 `/docs/:corpus/index.md` 与 corpus `_meta.json`
  - 生成 `/docs/:corpus/:collection/index.md` 与 detail `.mdx`
- 让 landing 文案使用成熟中文，不再出现开发占位式英文或口语提示。
- 保留 source/version 的低打扰摘要，并把技术字段放入折叠详情。

### Slice 2: Sidebar Config Builder

- 新增/收口 `rspress-sidebar` builder，直接消费 `_meta.json`。
- 支持 `file`、`dir`、`section-header` entries。
- 保持 Rspress native sidebar 数据结构，不自建 shell。
- 让 typecheck 能把 builder 输出赋给 Rspress `themeConfig.sidebar`。

### Slice 3: Local Scaffold Convergence

- 更新 `ensure-docs-scaffold`：
  - 生成与 published reader sync 一致的 `/docs/...` scaffold
  - 保留已有真实文档，不覆盖 collection `index.md`
  - 只在缺失时补根首页、公开文档总览、corpus/collection landing 与 `_meta.json`
- 移除旧 scaffold 对 `student-handbook` / `curriculum-plan` 根目录的默认依赖。

### Slice 4: Generated Content Guard

- 更新 `.gitignore`，忽略 `apps/public-docs/docs/docs/**`。
- 更新 generated docs checker，拒绝新的 generated detail path 进入 git tracking。
- 保持 root scaffold 文件允许 tracked，generated detail 文件禁止 tracked。

### Slice 5: Verification

- 单测覆盖 published reader sync、generated guard、local scaffold 与 legacy
  sync-real-docs UI。
- 执行 `public-docs` typecheck、generated guard 与 build。
- 执行 planning/docs lint、YAML lint 与 diff whitespace check。

## Exit Rule

Phase 3 完成后：

- `public-docs` 仍使用 Rspress 原生 shell。
- published reader docs 的长期路由为 `/docs/:corpus/:collection/:documentSlug`。
- 本地 scaffold 与 published reader IA 一致。
- generated reader detail 路径不会重新进入 git tracking。
- Phase 4 可以继续在该 IA 上实现 docs search、version navigation 与
  deep-link state。
