---
doc_type: phase_summary
phase: "2"
phase_name: "Registry Version Resolution"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 2 Summary

## Outcome

`versioned-history-query-foundation` 已完成第二层 registry version resolution 收口：

- `VersionQuery` 补齐了 bounded selector anchor：
  - `historical` 可显式指定 `version_id`
  - `compare` 可显式指定 `version_id -> compare_to_version_id`
  - 无显式 selector 时，`historical` 默认解析为 `previous`，`compare` 默认解析为 `previous vs current`
- `DocumentRegistry` 新增 `list_versions(...)`
- `campus_ingestion_core.version_resolution` 新增 registry-backed resolver：
  - `current`
  - `historical`
  - `as_of`
  - `compare`
- resolver 输出已成为 typed version-selection truth，而不是 retrieval/backend 的隐式黑盒分支
- unresolved/fail-close 语义已固定为 code-owned result

这一步只完成 registry resolution seam，不提前实现 retrieval version filter 或 `rag-agent` 回答语义。

## Implemented Surfaces

- `packages/contracts`
  - `VersionQuery.version_id`
  - `VersionQuery.compare_to_version_id`
- `apps/supervisor-api`
  - `/api/v1/answer` 支持 version selector anchors
- `packages/supervisor-core`
  - `frame_specialist_request()` 保留 version selector anchors
- `packages/ingestion-core`
  - `DocumentRegistry.list_versions(...)`
  - `ResolvedVersionSelection`
  - `ResolvedVersionQuery`
  - `resolve_version_query(...)`

## Verification

- `uv run --all-packages python -m unittest tests.contracts.test_models tests.api.test_supervisor_api tests.supervisor.test_supervisor_core tests.ingestion.test_version_resolution`

## Notes

- 当前 resolver 仍是 registry-owned seam，本 phase 不负责把它接进 retrieval request/filter。
- `Phase 3` 继续负责把 resolver 输出翻译成 retrieval candidate pre-filter。
