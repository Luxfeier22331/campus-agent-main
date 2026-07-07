---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-03-28
updated: 2026-06-17
---

# App API HTTP Contract

## Document Boundary

This file is the stable index for browser-facing app-api HTTP contracts.
It owns exposure classes, cross-cutting rules, shared response shapes and
endpoint grouping. Detailed endpoint bodies live in split contract docs.

## Split Documents

- `system-auth-memory.md`
  - System, auth and profile memory: health, auth, me and memory endpoints
- `chat.md`
  - Chat: conversation, request, stream and event endpoints
- `operator.md`
  - Operator: operator request list and detail endpoints
- `identity.md`
  - Account center and identity product projection endpoints
- `federation.md`
  - Federation provider surface
- `operator-ops.md`
  - Operator ops cross-cutting contract
- `dining.md`
  - Student dining public projection endpoints
- `dining-ops.md`
  - Dining operations draft, release candidate, release and audit endpoints
- `document-reader.md`
  - Document reader published asset and read-model contract

## Scope

这里的 API 是 `app-api` 的 browser-facing app contract。

长期调用形态固定为：

- `browser -> campus-web same-origin /api/* -> app-api`
- `browser -> operator console surface same-site /api/* -> app-api`

因此：

- browser 默认不直连 `app-api` public hostname
- web surface 可以做 route proxy / BFF
- 但 proxy 后的 contract 必须保持与这里一致
- Worker web surfaces 必须通过 `APP_API` Service Binding 调用 `app-api`；其中
  `https://app-api.internal` 只是内部 Request URL origin
- `api-staging.mucwiki-edge.link` 如存在，只能作为 staging machine / ops ingress，
  不是本文 browser-facing app contract
- `official_web` collector command surface、operator observability detail、eval
  ingress、request lifecycle and error model are owned by their split docs

## Route Exposure Classes

`apps/app-api/src/app/route-exposure.ts` 是当前 route exposure inventory 的代码侧
contract test carrier。新增 route 必须声明：

- `browser-surface`：由 campus-web same-origin proxy 调用
- `operator-via-panel`：由 Operator Console internal trusted caller 调用；当前代码名保留
  `panel`，不表示长期只存在 `operator-console-web` 一个 product concept
- `machine-internal`：由 execution-control / eval / ingestion 等 trusted machine
  caller 调用
- `collector-machine`：由 official-web collector command caller 调用
- `system`：health / readiness probe

## Cross-Cutting Rules

- JSON body 使用 `camelCase`
- enum / code value 使用小写语义值，例如 `completed`、`no_answer`、`validation_failed`
- `POST /api/chat/requests` 与 `POST /api/chat/requests/stream` 支持
  `Idempotency-Key` header
- `requestId` 是业务级 correlation id；`traceId` 是 runtime trace correlation id
- `POST /api/chat/requests` 成功时返回 `x-request-id` 与 `x-trace-id`
- 所有错误响应使用 `docs/contracts/app-api/error.md` 中定义的统一 envelope

## Endpoint Families

This index only routes endpoint families to their owners:

- system, auth and profile memory: `system-auth-memory.md`
- chat conversation, request, stream and run lifecycle: `chat.md`
- account center and identity projection: `identity.md`
- federation provider surface: `federation.md`
- operator request list and detail: `operator.md`
- expanded operator observability, quality, safety, cost and audit:
  `observability.md`
- runtime stage timing safe projection: `../stage-timing.md`
- operator ops cross-cutting rules: `operator-ops.md`
- dining public projection: `dining.md`
- dining operations, release and audit: `dining-ops.md`
- document reader published asset and read model: `document-reader.md`
- campus map route semantics: `docs/architecture/domains/navigation/architecture.md`
  and `docs/domains/place.md`
- campus shuttle status route semantics: `docs/domains/transport.md`

Route inventory is verified by `apps/app-api/src/app/route-exposure.ts`.

## Explicit Non-Goals

- 不把已退役 standalone chat app 的旧 `/api/answer` 继续提升为 forward contract
- 不为 Operator Console 暴露 database/admin-console 风格 API
- 不让 operator endpoints 旁路读取 `runtime.request_execution`
- 不把 `packages/contracts` 直接当 browser product API
- 不冻结 provider raw token streaming chat API
- 不在本索引重复各分册的 endpoint body 或 response DTO
