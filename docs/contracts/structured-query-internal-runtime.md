---
doc_type: contract
truth_scope: execution
owner_boundary: apps/execution-control
status: active
created: 2026-06-13
updated: 2026-06-13
---
# Structured Query Internal Runtime Contract

## Document Boundary

This document freezes the execution-control-owned internal query service seam
used by typed structured capabilities. It does not own product serving opening,
app-api browser HTTP contracts or source-truth schemas.

It complements:

- `docs/contracts/capability-execution.md`
- `docs/architecture/system/tool-and-capability-runtime-architecture.md`
- `docs/architecture/domains/campus-services/architecture.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`

## Endpoint Family

Go `apps/execution-control` owns the internal structured query endpoint family:

- `POST /internal/query/campus-services/transport-schedule`
- `POST /internal/query/notices/discover`
- `POST /internal/query/notices/get`

这组 endpoint 是 `domain capability -> thin adapter -> internal query
service` 的 Docker-local seam，不是 browser-facing API，也不是 `app-api`
product/control-plane endpoint。

Contract rules:

- 仅允许 repo-owned trusted internal runtime caller 使用
- 请求头使用 `x-execution-query-auth`，语义为 execution-control owned internal
  query authorization；不接受旧 supervisor header alias。
- JSON 命名保持 `snake_case`
- response body 对齐对应 tool result contract 的 safe typed summary
- runtime 只读 configured projection / normalized truth；不得 query-time 回扫 raw
  source bundle、notice HTML 或 generic retrieval chunk

## Contracted Read-Model Backing

The structured query family reads PostgreSQL release current pointer + typed
read model backing for these deterministic capabilities:

- `transport_schedule_lookup`
  - supports current snapshot metadata, route clarification, first / next /
    last departure, departure list, service window, timetable and temporary
    suspension summary
- `campus_notice_discover`
- `campus_notice_get`
  - reads Go-owned PG read model plus S3-compatible source-backed bounded
    context runtime; notice requests use a `payload + access_context` envelope
    so source-family, read-model and fail-close constraints stay inside Go

## Serving Boundary

This contract does not open `campus_services` or `notice` product serving. Product
opening remains owned by surface capability policy, current architecture and the
matching domain architecture.

Structured capability production readiness is not defined by query-kernel
executability alone. Normal, fail-close, cancel, timeout, late-completion and
replan outcomes must enter sanitized step trajectory and app-api operator read
model before a structured capability can be considered production-open.
