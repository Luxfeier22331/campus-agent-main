---
doc_type: roadmap
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Roadmap: Versioned History Query Foundation

## Overview

这条 workstream 只负责版本化查询能力本身：
显式 query mode、registry version resolution、retrieval version filter、answer semantics 与 eval。
它不替代 freshness/live retrieval 线，也不把“保留历史版本”误写成“已经支持历史查询”。

## Phases

- [x] **Phase 1: Request Protocol** — 已为 `SupervisorRequest -> RagRequestPayload` 落地显式 `version_query` contract，冻结 `current / historical / as_of / compare`、默认 `current` 兼容语义，以及版本化请求不允许隐藏在 prompt 文本中的约束。
- [x] **Phase 2: Registry Version Resolution** — 已补齐 bounded version selector、`DocumentRegistry.list_versions(...)` 与 registry-backed resolver，把 `current / historical / as_of / compare` 解析成 retrieval 前可消费的 typed version-selection truth。
- [x] **Phase 3: Retrieval Version Filter** — 已为 `RetrievalRequest`、`backend_qdrant` 与 `rag-agent` 接入 version-range pre-filter，明确 historical single-document 请求必须先解析版本选择，再带着 `version_id / revision_track` 过滤进入 retrieval。
- [x] **Phase 4: Specialist Answer Semantics** — 已为 `rag-agent` 落地 `historical / as_of / compare` 的 deterministic answer semantics：historical 明确非现行提示，as_of 明确时间锚点，compare 明确旧版/新版/变化点结构并在单侧证据缺失时 fail-close。
- [x] **Phase 5: Eval Coverage** — 已为 versioned-history query 补齐 typed `GoldenCase.version_query`、`versioned_history_regression_locked_cases()`、version-aware semantic metric，以及 `version_filter_unresolved / compare_support_incomplete` fail-close regression。
