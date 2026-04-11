---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-12
---

# Product Runtime Architecture

## 文档边界

本文冻结 public chat、protected panel、shared `app-api` 与 delivery/runtime seam 的 supporting architecture。

它回答的是：

- public/protected surface 如何接入 shared backend
- `apps/app-api` 的长期职责是什么
- request projection 与 operator read surface 属于谁
- protected panel 的 trust model 与 runtime shell 应怎样理解

## 核心结论

产品/runtime 主链路固定为：

`browser -> public-chat-web -> app-api -> supervisor-api`

`browser -> protected-panel-web -> app-api -> request projection / operator read model`

这意味着：

- `apps/public-chat-web` 与 `apps/protected-panel-web` 是两个 browser surface
- `apps/app-api` 是 shared product/control-plane backend
- `apps/supervisor-api` 是 internal execution engine
- panel 不读数据库、不读 telemetry sink、不绕过 `app-api`

## Current Accepted Surface Posture

当前 merged truth 下，产品/runtime 形态已经明确到以下粒度：

- `public-chat-web`
  - 已是公开产品入口，不再以旧 `public-consumer-chat` 为 forward truth
- `protected-panel-web`
  - 当前只承接 app-owned operator domains；`Requests` 与 `Official Web` 已是 accepted shape
  - `Jobs`、`Operations`、更完整 `Audit` 仍属于后续 rollout，不应被写成当前 merged truth
- `apps/app-api`
  - 已同时承担 product backend 与 selected operator control-plane backend
  - `official_web` control plane 已是 accepted runtime domain，不再是旁路后台

部署命名、Cloudflare Access 配置与 staging 细节不写在本文，统一看 runbooks。

## Surface Responsibilities

### `apps/public-chat-web`

- public chat UI
- same-site `/api/*` seam into `apps/app-api`
- 不拥有 auth/session/conversation truth

### `apps/protected-panel-web`

- protected operator UI shell
- 只消费 runtime APIs
- fail-closed by default
- 不导入 `packages/*`，不把自己做成 `apps/supervisor-api` 的 hidden admin mode

### `apps/app-api`

- auth / session / principal mapping
- conversation 与 chat ingress
- `runtime.request_execution`
- `runtime.projection_outbox`
- `operator.request_projection`
- selected operator control-plane domains，例如 `official_web`

### `apps/supervisor-api`

- internal execution admission
- typed execution transport
- 不承担 browser-facing product backend 责任

## Request Projection And Read Model

request projection 的 canonical durable truth 固定为：

- `runtime.request_execution`
- `runtime.projection_outbox`

panel `Requests` 的 canonical read path 固定为：

`apps/protected-panel-web -> apps/app-api -> operator.request_projection`

明确禁止：

- 直接读取 consumer chat tables 作为 request list/detail truth
- 直接读取 audit logs 或 telemetry sink 作为 request truth
- 让 panel 通过 `apps/supervisor-api` 旁路获取 operator list/detail

future operator-facing observability 域也遵循同一 ownership rule：

- audit / quality / safety / cost surface 仍由 `apps/app-api` 物化与提供
- panel 只能读取 runtime-owned projection / aggregate APIs
- `Sentry`、`Axiom` 与其他 sink 继续只是 debugging / analysis / grading surface，不反向成为 canonical panel read model

## Protected Surface And Operator Access

protected panel 的长期 access model 固定为：

`approved operator principal -> upstream protected access -> origin admission -> minimal operator context -> runtime APIs`

关键约束：

- protected panel 不需要自建 end-user 账户系统
- upstream access 不能替代 origin admission
- dynamic shell/API responses 默认 `no-store`
- 失去保护条件时直接 fail-closed

## Runtime / Delivery Posture

- shared `apps/app-api` runtime 已冻结为 Worker
- public/protected browser surface 可以是独立 Worker web surface
- public 与 protected surface 即使共享基础设施，也不合并成一个 exposure model 或 rollback unit
- `apps/supervisor-api` 的 runtime 选择仍保持边界先行，不因 `app-api` 已是 Worker 而被提前冻结

## Forbidden Shapes

- 不把 `apps/app-api` 重新拆回 consumer backend + panel backend
- 不把 `apps/supervisor-api` 重新长成 product backend
- 不把 panel 做成直接连 `packages/*` 或数据库的内部控制台
- 不把 request projection 退化成 chat transcript 或 telemetry replay 的别名

## 相关稳定文档

- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/data/app-api-schema.md`
- `docs/decisions/adr-0011-protected-panel-worker-runtime.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/decisions/adr-0023-operator-observability-control-plane-and-sink-participation.md`
- `docs/architecture/operator-observability-architecture.md`
