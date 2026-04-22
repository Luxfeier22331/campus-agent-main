---
doc_type: decision
decision_id: ADR-0016
status: accepted
created: 2026-03-28
updated: 2026-04-10
---

# ADR-0016 App API Request Projection And Panel Query Ownership

适用范围：operator-facing request list/detail、shared `app-api` request projection、panel `Requests` domain 的长期 ownership

## 背景

当前仓库已经具备以下事实：

- `apps/supervisor-api` 是 execution engine boundary
- `apps/app-api` 已被接受并实现为 shared application/control-plane backend
- `packages/supervisor-core` 已能产出最小 audit record
- `apps/supervisor-api` 当前仍会把该 audit record 持久化到 JSONL
- chat conversation history 会记录 `request_id`
- protected panel 已冻结为 `runtime APIs only` 的 protected Worker shell；forward web-surface 名称为 `apps/protected-panel-web`

但仓库仍缺一条长期清晰规则：

- operator-facing `Requests` 应该由谁生产和提供

如果这条规则不冻结，后续很容易出现四种腐烂路径：

- panel 直接读 audit log 或 telemetry sink
- conversation store 被误当成 request truth
- `packages/supervisor-core` 被反向扩成 request read-model host
- `apps/supervisor-api` 顺手继续长成 panel query backend

## 决策 1：canonical request facts 与 projection input 在 shared `app-api` command path 内一次产出

结论：

- canonical request facts 与 projection input 必须在 shared `app-api` handling 内一次产出
- `operator.request_projection` 可以在同一 boundary 内异步物化
- 不采用 panel、日志系统或其他下游组件事后重算的形态

原因：

- `app-api` 同时拥有产品层 request identity、principal、conversation correlation、execution correlation 与 request status 的闭环上下文
- 在这条链路内一次产出，能避免多处拼装、多真相源和时序错位

## 决策 2：第一 owner 冻结为 `apps/app-api`

结论：

- 当前第一 owner 固定为 `apps/app-api`
- 它负责：
  - `runtime.request_execution` / `runtime.projection_outbox`
  - `request_projection` 物化
  - request list/detail runtime API

原因：

- `apps/app-api` 是 public chat 与 protected panel 的 shared application/control-plane backend
- 它负责 chat ingress，并且是最适合收口 request ledger / query surface 的边界
- 该决策不要求把 request projection host 下沉到 `packages/*`

补充：

- 本 ADR 不冻结具体 projection store 必须是某个数据库或托管产品

## 决策 3：`apps/supervisor-api` 继续只是 execution engine

结论：

- `apps/supervisor-api` 继续负责 answer execution
- 不负责 request projection store、list/detail API 或 panel query serving

原因：

- execution engine 与 operator query 是不同产品边界
- 否则会重新把 `supervisor-api` 扩回产品 backend

## 决策 4：`packages/supervisor-core` 只拥有最小 audit / trace projector

结论：

- `packages/supervisor-core` 继续拥有最小 audit / trace 语义投影
- 不拥有 request projection store、list/detail API 或面向 panel 的 read model host

原因：

- supervisor-core 的职责是编排与最小治理语义，而不是产品 surface 数据面
- 这样可以保持 `packages/*` 与 `apps/*` 的长期边界清晰

## 决策 5：以下数据面不是 canonical request projection truth

结论：

以下都不是 panel `Requests` 的 canonical truth：

- `chat.*` conversation / message store
- 历史 standalone public chat conversation / message store
- JSONL audit sink
- `Axiom`、`Sentry` 或其他 telemetry sink
- raw trace dump

原因：

- conversation store 只承载 consumer UX history
- audit / telemetry 主要服务于 observability、debugging 与 governance
- 把这些数据面直接当 operator-facing request read model，会导致 schema、权限和生命周期腐烂

## 决策 6：panel 只能消费 `app-api` 暴露的 runtime-owned request APIs

结论：

- `apps/protected-panel-web` 的 `Requests` domain 只能读 `apps/app-api` 暴露的 request projection APIs
- panel Worker-local BFF 不得扫描 log、会话表或 telemetry sink 来拼 request list/detail

原因：

- panel 已冻结为 `runtime APIs only`
- 这可以避免 panel 演化成第二个业务后端或调试后门

## 后果

直接结果：

- `GET /api/operator/requests` / `GET /api/operator/requests/:requestId` 应由 `apps/app-api` 或其继任 shared app boundary 提供
- panel `Requests` 的合法数据源固定为这些 runtime-owned APIs
- chat 会话可以继续记录 `request_id` 用于 UX 关联，但不承担 operator-facing request truth

明确不做：

- 不让 panel 直接读取 JSONL audit
- 不让 telemetry sink 兼任 panel 主数据面
- 不把 request projection read-model host 做进 `packages/supervisor-core`
- 不让 `apps/supervisor-api` 顺手扩成 panel 查询后端

## 相关文档

- `docs/architecture/product-runtime-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/operator-observability-architecture.md`
