---
doc_type: phase_plan
phase: "4"
phase_name: "Docs Search, Version Navigation, And Static Reader State"
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 4 Plan

## Objective

把 docs search、current/historical version navigation 与 reader static state
收口到 `app-api` docs control-plane 和 `public-docs` Rspress native shell 之间的
长期边界：API 只暴露 browser-safe canonical reader target，文档站只负责渲染静态
reader asset、版本切换与临时高亮状态。

## Execution Slices

### Slice 1: API Canonical Reader Targets

- 为 app-api docs search 统一 canonical URL format：
  `/docs/...?...#anchor`。
- 为 app-api resolve 增加 historical reader canonical URL：
  `/docs/:corpus/:collection/:documentSlug/v/:versionSlug`。
- 保持 current version canonical URL 不带 `/v/...`，作为稳定公开 alias。
- 保持 docs search 只查询 current public static subset。

### Slice 2: Public Sync Manifest Version Coverage

- 从 docs read model 导出 public sync manifest 时包含所有
  `visibility=public`、`deliveryMode=public_static_asset`、无 entitlement 的版本。
- manifest entry 显式携带 `isCurrent` 与 `versionLabel`。
- 不把 gated/restricted version 纳入 public sync manifest。

### Slice 3: Static Reader Version Routes

- `sync-published-reader-docs` 为每个 public version 生成
  `/docs/:corpus/:collection/:documentSlug/v/:versionSlug.mdx`。
- 只为 current version 生成 alias
  `/docs/:corpus/:collection/:documentSlug.mdx`。
- collection landing 和 sidebar 只按 current docs 计数，避免 historical version
  造成重复条目。
- reader metadata panel 写入 browser-safe dataset，用于 client enhancer 获取版本列表。

### Slice 4: Reader State Enhancer

- 新增 reader state parser，兼容新格式 `?hl=...#anchor` 与 legacy
  `#anchor?hl=...`。
- 用 `hl` 的 root unit ids 标记 reader block highlight。
- 在 metadata panel 中注入低打扰 version switcher。
- 版本切换 href 保留当前 anchor 与 highlight state。

### Slice 5: Search Enhancement

- 保留 Rspress local search fallback。
- 从 Rspress search index pages 收集 docs search scope。
- 对每个 scope 调用 same-site `/api/docs/collections/:corpus/:collection/search`。
- 将 app-api docs search result 映射为 Rspress suggestion group。
- API 失败或无结果时回退到本地搜索，不阻断 docs site。

### Slice 6: Verification

- 用 TDD 覆盖 app-api canonical URL、public sync manifest version coverage、
  published reader docs version route generation、reader state parser / href builder、
  docs-api search suggestion mapping 与 generated guard。
- 执行 public-docs test/typecheck/lint:generated/build。
- 执行 app-api docs service targeted tests 与 app-api typecheck。

## Exit Rule

Phase 4 完成后：

- docs reader 支持 current alias 与 explicit historical version route。
- search/source jump URL 使用 query-before-hash，并能在 reader 侧高亮 root units。
- version switcher 不替换 Rspress shell，不暴露敏感 locator。
- Phase 5 可以直接把 public chat source cards 接入 canonical reader jump。
