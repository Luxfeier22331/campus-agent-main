---
doc_type: phase_summary
phase: "1"
phase_name: "Request Protocol"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 1 Summary

## Outcome

`versioned-history-query-foundation` 已完成第一层 request protocol 收口：

- `SupervisorRequest` 新增独立 `version_query`
- `RagRequestPayload` 新增独立 `version_query`
- knowledge query path 正式承认：
  - `current`
  - `historical`
  - `as_of`
  - `compare`
- 无显式 `version_query` 的旧请求继续默认 `current`

这一步只冻结 typed request seam，不提前实现 registry version resolution、retrieval version filter 或 `rag-agent` answer semantics。

## Implemented Surfaces

- `packages/contracts`
  - `VersionQueryMode`
  - `VersionQuery`
  - `SupervisorRequest.version_query`
  - `RagRequestPayload.version_query`
- `apps/supervisor-api`
  - `/api/v1/answer` 支持 `version_query`
- `packages/supervisor-core`
  - `SupervisorRequestContext` 保留 `version_query`
  - `frame_specialist_request()` 将 `version_query` 透传到 `rag-agent`
  - `place_lookup` 请求禁止使用非 `current` 的 `version_query`

## Verification

- `uv run --all-packages python -m unittest tests.contracts.test_models tests.supervisor.test_supervisor_validation tests.supervisor.test_supervisor_core tests.api.test_supervisor_api`

## Notes

- 本 phase 只证明“版本化意图已成为 typed request truth”，不证明历史版本已经能被正确解析、过滤或回答。
- `Phase 2` 继续负责 registry version resolution。
