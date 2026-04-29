---
phase: "1"
name: "Document Site Architecture And Contract Freeze"
created: 2026-04-21
updated: 2026-04-23
status: completed
---

# Phase 1 Summary

## Result

`Phase 1` 已完成文档站的 architecture / contract / data freeze，并把这条能力正式收口成 repo-native active workstream。

本 phase 已冻结：

- `public-docs` 是独立 browser surface，不并入 `public-chat-web`
- canonical doc 正文优先走 published static reader assets，而不是 `/api/docs/*` 整篇正文返回
- `app-api` 是 docs navigation / resolve / version / search 的 control-plane owner
- `anchor + rootUnitId` 是 reader / search / source-card 统一的用户态定位单位
- chat 来源展示必须跳回 canonical reader，而不是暴露 raw chunk / source locator
- public / restricted / historical reader 共用同一 reader truth，只在 admission / delivery mode 上分化

## Outputs

- `docs/architecture/system/document-site-architecture.md`
- `docs/contracts/app-api-document-reader-http.md`
- `docs/contracts/document-reader-publish-contract.md`
- `docs/data/canonical-document-reader-model.md`
- `.planning/workstreams/document-site-and-canonical-reader/REQUIREMENTS.md`
- `.planning/workstreams/document-site-and-canonical-reader/`

## Verification

- 新增索引入口已接入：
  - `docs/architecture/README.md`
  - `docs/contracts/README.md`
  - `docs/data/README.md`
  - `docs/plans/README.md`
- `git diff --check` 已通过本 phase 相关 planning/docs 文件集合

## Next

下一步进入 `Phase 2: Published Reader Assets And App API Docs Control Plane`。
该 phase 的目标是把 `Phase 1` 已冻结的 truth 变成真正的 runtime seams 和 published artifacts，
而不是提前做 donor shell 或 reader UI。
