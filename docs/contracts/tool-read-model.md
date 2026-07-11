---
doc_type: contract
truth_scope: execution
owner_boundary: apps/execution-control
status: active
created: 2026-06-13
updated: 2026-07-10
---
# Tool Read Model Internal Runtime Contract

## Document Boundary

This document freezes the execution-control-owned internal query service seam
used by OpenAI Agents SDK function tools. It does not own product serving opening,
app-api browser HTTP contracts or source-truth schemas.

It complements:

- `docs/contracts/tool-execution.md`
- `docs/architecture/system/tool-runtime.md`
- `docs/architecture/domains/campus-services/architecture.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`

## Endpoint Family

Go `apps/execution-control` owns the internal tool read model endpoint family:

- `POST /internal/query/campus-services/transport-schedule`
- `POST /internal/query/knowledge/search`

这组 endpoint 是 `domain tool -> thin adapter -> internal query
service` 的 Docker-local seam，不是 browser-facing API，也不是 `app-api`
product/control-plane endpoint。

Contract rules:

- 仅允许 repo-owned trusted internal runtime caller 使用
- 请求头使用 `x-execution-query-auth`，语义为 execution-control owned internal
  query authorization；不接受旧 runtime header alias。
- JSON 命名保持 `snake_case`
- response body 对齐对应 tool result contract 的 safe typed summary
- runtime 只读 configured projection / normalized truth；不得 query-time 回扫 raw
  source bundle、notice HTML 或 generic retrieval chunk

## Internal Projection Endpoints

Go `apps/execution-control` also owns internal read-model projection endpoints
when a browser-facing surface needs a stable display projection instead of a
tool result:

- `GET /internal/projections/campus-services/transport-schedule/status`

This endpoint returns the current transport status display projection described
by `docs/domains/transport.md`. It is not a tool endpoint, does not
accept arbitrary date query, does not return a structured tool result envelope
and does not make `app-api` the owner of campus-services transport schedule
truth.

## Contracted Read-Model Backing

The tool read model family reads PostgreSQL release current pointer + typed
read model backing for these deterministic tools:

- `transport_schedule_lookup`
  - supports current snapshot metadata, route clarification, first / next /
    last departure, departure list, service window, timetable and temporary
    suspension summary

`knowledge_search` reads admitted indexed knowledge through scope/version
validation, embedding, Qdrant lookup and optional rerank. It is internal-only
and available only to the Knowledge Agent.

No notice read-model runtime tool endpoint is currently active. The old notice
query endpoint has been removed from ToolSpec, runtime configs, workflow
artifacts and contracts. Notice source/data materialization can still exist in
the ingestion plane, but it does not make a serving tool endpoint available.

## Serving Boundary

This contract does not open `campus_services` or `notice` product serving.
Runtime opening requires a model-visible SDK tool admitted by execution-control
and the matching domain serving truth.

Tool production readiness is not defined by query-kernel executability alone.
Normal, fail-close, cancel, timeout and late-completion outcomes must enter
sanitized trajectory and app-api operator read model before a tool can be
considered production-open.
