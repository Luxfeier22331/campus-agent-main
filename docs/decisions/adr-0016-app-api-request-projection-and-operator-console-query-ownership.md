---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0016
status: accepted
created: 2026-03-28
updated: 2026-04-26
---
# ADR-0016 App API Request Projection And Operator Console Query Ownership

适用范围：operator-facing request list/detail、shared `app-api` request
projection、Operator Console `Requests` domain 的长期 ownership

## 背景

当前仓库已经具备以下事实：

- `apps/execution-control` 是 execution engine boundary
- `apps/app-api` 已被接受并实现为 shared application/control-plane backend
- `apps/execution-control` 当前拥有 execution audit summary 与 response
  observability projection
- chat conversation history 会记录 `request_id`
- Operator Console 的当前 read-only implementation surface 是 `apps/operator-console-web`，
  并已冻结为 `runtime APIs only` 的 protected Worker shell

但仓库仍缺一条长期清晰规则：

- operator-facing `Requests` 应该由谁生产和提供

如果这条规则不冻结，后续很容易出现四种腐烂路径：

- Operator Console 直接读 audit log 或 telemetry sink
- conversation store 被误当成 request truth
- `apps/supervisor-agent-worker` 被反向扩成 request read-model host
- `apps/execution-control` 顺手继续长成 Operator Console query backend

## 决策 1：canonical request facts 与 projection input 一次产出

结论：

- canonical request facts 与 projection input 必须在 shared `app-api` handling 内一次产出
- `operator.request_projection` 可以在同一 boundary 内异步物化
- 不采用 Operator Console、日志系统或其他下游组件事后重算的形态

原因：

- `app-api` 同时拥有产品层 request identity、principal、conversation
  correlation、execution correlation 与 request status 的闭环上下文
- 在这条链路内一次产出，能避免多处拼装、多真相源和时序错位

## 决策 2：第一 owner 冻结为 `apps/app-api`

结论：

- 当前第一 owner 固定为 `apps/app-api`
- 它负责：
  - `runtime.request_execution` / `runtime.projection_outbox`
  - `request_projection` 物化
  - request list/detail runtime API

原因：

- `apps/app-api` 是 public chat 与 Operator Console surfaces 的 shared
  application/control-plane backend
- 它负责 chat ingress，并且是最适合收口 request ledger / query surface 的边界
- 该决策不要求把 request projection host 下沉到 `packages/*`

补充：

- 本 ADR 不冻结具体 projection store 必须是某个数据库或托管产品

## 决策 3：`apps/execution-control` 继续只是 execution engine

结论：

- `apps/execution-control` 继续负责 answer execution
- 不负责 request projection store、list/detail API 或 Operator Console query serving

原因：

- execution engine 与 operator query 是不同产品边界
- 否则会重新把 `execution-control` 扩回产品 backend

## 决策 4：agent worker 不拥有 Operator Console read model host

结论：

- `apps/supervisor-agent-worker` 只返回 private `CapabilityResponse`
- 不拥有 request projection store、list/detail API 或面向 Operator Console 的 read
  model host
- execution audit summary、response observability projection 与 public
  finalization 由 `apps/execution-control` 拥有

原因：

- agent worker 的职责是 private semantic worker，而不是产品 surface 数据面
- 这样可以保持 product-layer、execution runtime 与 agent semantic worker 的边界清晰

## 决策 5：以下数据面不是 canonical request projection truth

结论：

以下都不是 Operator Console `Requests` 的 canonical truth：

- `chat.*` conversation / message store
- 历史 standalone public chat conversation / message store
- JSONL audit sink
- `Axiom`、`Sentry` 或其他 telemetry sink
- raw trace dump

原因：

- conversation store 只承载 consumer UX history
- audit / telemetry 主要服务于 observability、debugging 与 governance
- 把这些数据面直接当 operator-facing request read model，会导致 schema、权限和生命周期腐烂

## 决策 6：Operator Console 只能消费 `app-api` 暴露的 runtime-owned request APIs

结论：

- Operator Console `Requests` domain 只能读 `apps/app-api` 暴露的 request projection APIs。
  当前 read-only implementation surface 是 `apps/operator-console-web`。
- Operator Console Worker-local BFF 不得扫描 log、会话表或 telemetry sink 来拼 request list/detail

原因：

- Operator Console 已冻结为 `runtime APIs only`
- 这可以避免 Operator Console 演化成第二个业务后端或调试后门

## 后果

直接结果：

- `GET /api/operator/requests` / `GET /api/operator/requests/:requestId` 应由
  `apps/app-api` 或其继任 shared app boundary 提供
- Operator Console `Requests` 的合法数据源固定为这些 runtime-owned APIs
- chat 会话可以继续记录 `request_id` 用于 UX 关联，但不承担 operator-facing request truth

明确不做：

- 不让 Operator Console 直接读取 JSONL audit
- 不让 telemetry sink 兼任 Operator Console 主数据面
- 不把 request projection read-model host 做进 `apps/supervisor-agent-worker`
- 不让 `apps/execution-control` 顺手扩成 Operator Console 查询后端

## 相关文档

- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/system/execution-agent-layer-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
