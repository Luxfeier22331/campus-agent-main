---
doc_type: plan
status: completed
created: 2026-03-28
updated: 2026-04-22
---

# Versioned History Query Foundation

## Completion Note

这条 `versioned history query foundation` workstream 已关闭。
它完成的是版本化查询能力本身的基础收口：
显式 request protocol、registry version resolution、retrieval version filter、
specialist answer semantics 与 eval coverage。

## What This Plan Closed

- 冻结 `current / historical / as_of / compare` 的 typed `version_query` contract
- 补齐 registry-backed version resolution：
  - `historical` 默认 `previous`
  - `compare` 默认 `previous vs current`
  - `resolve_version_query(...)` 输出 typed version-selection truth
- 补齐 retrieval pre-filter：
  - `RetrievalRequest.target_version_ids`
  - `RetrievalRequest.target_revision_track`
  - non-current 查询在 retrieval candidate 阶段先做 version filter
- 冻结 `rag-agent` 的 version-aware answer semantics：
  - `historical_grounded_answer`
  - `as_of_grounded_answer`
  - `compare_grounded_answer`
  - `version_filter_unresolved` / `compare_support_incomplete` fail-close
- 补齐 eval coverage：
  - `GoldenCase.version_query`
  - `versioned_history_regression_locked_cases()`
  - version-aware semantic metric
  - handbook / curriculum legacy live executor version-query passthrough
  - `app-api` eval client 对 non-current case 的 fail-fast guard

## Current Canonical Entry

- `docs/architecture/retrieval-serving-architecture.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `.planning/workstreams/versioned-history-query-foundation/STATE.md`
- `.planning/workstreams/versioned-history-query-foundation/ROADMAP.md`
- `.planning/workstreams/versioned-history-query-foundation/REQUIREMENTS.md`
- `docs/plans/README.md`
- `.planning/WORKSTREAMS.md`

## Reopen Rule

只有在 repo 重新 admission runtime-facing non-current query route contract、
`app-api` live benchmark 正式承载 non-current `version_query`，
或显式改写 `current / historical / as_of / compare` 的 request / resolution / retrieval / answer / eval truth 时，
才应恢复这条 workstream。
