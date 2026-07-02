---
doc_type: index
truth_scope: product
owner_boundary: domains/docs-reader
status: active
created: 2026-06-28
updated: 2026-06-28
---
# Docs Reader Domain

## 先看什么

- 文档站架构：`../architecture/system/document-site.md`
- source-card / permalink 窄能力：`source-card.md`
- 当前 merged truth：`../architecture/current.md`
- 通用执行态入口：`README.md`

## Architecture

- `../architecture/system/document-site.md`
- `../architecture/system/product-runtime.md`
- `../architecture/system/file-asset-loader.md`

## Contracts And Data

- `source-card.md`
- `../contracts/app-api/document-reader.md`
- `../contracts/document-reader-publish.md`
- `../data/document-reader.md`

## Decisions

- `../decisions/adr-0051-campus-docs-rspress-reader-surface.md`

## Verification / Reference

- `../reference/testing-and-verification-lanes.md`

## 执行路由

- 当前 merged truth 统一看 `../architecture/current.md`。
- 文档站 reader、control-plane API、published asset 与 source-card permalink
  的长期边界统一看上面的 source-card / architecture / contract / data owner 文档。
