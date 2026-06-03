---
doc_type: phase_context
phase: "4"
phase_name: "Docs Search, Version Navigation, And Static Reader State"
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 4 Context

## Starting Point

`Phase 3` 已把 `public-docs` 收口到 Rspress native shell 与
`/docs/:corpus/:collection/:documentSlug` published reader IA。`Phase 2`
已提供 `app-api` docs navigation / resolve / versions / search seams、same-site
`/api/docs/*` proxy，以及 published reader docs/static asset sync。

本 phase 的目标是在不替换原生 Rspress shell 的前提下补齐 reader 运行态状态：

- Rspress 原生搜索索引只用于 scope discovery；search result owner 是
  `app-api` docs search，不能由本地静态索引补结果。
- source-card / search jump URL 必须使用 `?hl=...#anchor`，避免旧式
  `#anchor?hl=...` 破坏 browser state。
- current reader route 继续是 `/docs/:corpus/:collection/:documentSlug`。
- historical explicit reader route 为
  `/docs/:corpus/:collection/:documentSlug/v/:versionSlug`。
- `hl` 只是临时高亮状态，不承担版本、权限或历史查询语义。

## Boundaries

- 不重建自定义 topnav/sidebar/layout；继续挂载 Rspress global UI enhancer。
- 不实现 chat source cards；那是 `Phase 5`。
- 不打开 restricted/gated reader；那是 `Phase 6`。
- 不实现 historical search、`as_of`、compare 或非 current query-serving。
- 不把 object storage key、raw source locator、chunk id、sourceUnitKey 暴露给
  browser-facing 页面。
- `public-docs` 同步的是 public static reader subset；restricted 子集仍由
  admission/gated delivery 处理。

## Acceptance Focus

- app-api search canonical URL 统一为 query-before-hash。
- app-api resolve 对 historical version 返回显式 `/v/:versionSlug` canonical URL。
- public sync manifest 导出 current 与 historical public static versions。
- `public-docs` 为同一文档生成 current alias 与 explicit version route。
- collection landing 只统计 current docs，不因 historical version 重复计数。
- reader metadata panel 提供低打扰版本切换入口，并保持 anchor/highlight state。
- generated content guard 覆盖 `/docs/.../v/:versionSlug.mdx`。
