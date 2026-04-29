---
doc_type: phase_context
phase: "3"
phase_name: "Public Docs Shell Convergence And Information Architecture"
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 3 Context

## Starting Point

`Phase 2` 已完成 published reader assets、`app-api` docs read model/control-plane、
`public-docs` published reader docs/static asset sync 与 runbook。`public-docs`
本身已经是正式 Rspress app，且错误的 custom shell 已撤回。

本 phase 的问题不是创建新文档站，而是把已有 Rspress shell 的信息架构收口到
长期 reader truth：

- 入口应是文档首页与公开文档总览，而不是把 `student-handbook` /
  `curriculum-plan` 作为顶层并列路由。
- published reader docs 的生成路径应统一为
  `/docs/:corpus/:collection/:documentSlug`。
- 本地空 scaffold 应与 published reader IA 一致，且不得覆盖真实生成文档。
- generated content guard 必须覆盖新的 `apps/public-docs/docs/docs/**`
  生成路径，避免 deploy-time/docs-sync 产物进入 git tracking。

## Boundaries

- 保持 Rspress 原生 `OriginalLayout`、原生 topnav、原生 sidebar 与原生 outline。
- 不恢复或新增自建 docs shell。
- 不改变 Phase 2 的 publisher/read-model/control-plane 责任划分。
- 不让 `public-docs` 通过扫描对象存储决定 public subset。
- 不把 object key、raw source locator、chunk id 暴露到 browser-facing markdown。
- `sync-real-docs` 旧路径作为 legacy/dev 兼容存在，但不是 Phase 3 的默认
  published reader IA。

## Acceptance Focus

- published reader sync 生成 `/docs/...` IA、首页、总览、corpus landing、
  collection landing 与 reader detail。
- Rspress sidebar 从 `_meta.json` 生成稳定的层级结构：
  `文档首页 -> 公开文档 -> 规章制度/培养方案 -> 学生手册/培养方案`。
- 空 scaffold 与 published reader IA 保持一致。
- generated docs checker 拒绝新 generated detail 路径被 tracked。
- `public-docs` typecheck、generated guard 与 build 通过。
