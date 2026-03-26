---
doc_type: architecture
status: active
created: 2026-03-25
updated: 2026-03-25
---

# Cloudflare Public Entry Integration Contract

## 文档边界

这份文档只冻结 Phase 04.3 的 public-entry edge integration contract，不负责实现 Cloudflare 配置，也不替代以下文档：

- public entry 的边界归属：`docs/architecture/cloudflare-public-entry-boundary.md`
- public/protected surface 的 runtime topology：`docs/architecture/cloudflare-runtime-topology.md`
- 长期 `apps/*` / `packages/*` 分层：`docs/architecture/long-term-architecture.md`
- supervisor runtime shell 与 core 分层：`docs/architecture/supervisor-architecture.md`

## 目标

Phase 04.3 在这里冻结的是 Cloudflare public entry 与 `apps/supervisor-api` 之间的 runtime-facing contract：

- forwarding expectations
- request-id / trace propagation assumptions
- cache / body-size posture
- timeout / streaming boundary assumptions
- health / readiness seam

## Contract Conclusion

public entry 的 contract 固定为：

`Cloudflare public entry -> apps/supervisor-api runtime origin`

这条 contract 的重点不是应用逻辑，而是 runtime assumption：

- public entry 只能把请求转发到 `apps/supervisor-api`
- `apps/supervisor-api` 可以假定自己接到的是经过 edge admission 的 public-entry request
- edge/runtime 的 forwarding、trace、timeout、cache、body-size、streaming 规则必须在 runtime boundary 说清楚，而不是让后续实现靠猜

## Forwarding Contract

Cloudflare public entry 对 public runtime origin 的 forwarding contract 应明确以下原则：

- 只把允许的 public-entry request forward 给 `apps/supervisor-api`
- 转发后的 request 仍然是 supervisor-facing runtime ingress，而不是 specialist-facing 或 package-facing 调用
- forwarding 规则是 runtime contract，不构成 `packages/*` 输入 contract 的一部分

## Request-ID And Trace Contract

public entry 与 runtime origin 之间必须明确区分两类信息：

- request-id / trace context
  用于 runtime-level observability 与 request correlation
- app-layer actor identity
  由 Phase 5 定义，不在本 phase 内解决

因此这里冻结：

- `apps/supervisor-api` 可以依赖存在 runtime-level request correlation context
- request-id / trace propagation 不得被误写成 `SupervisorRequest.actor`
- trace propagation 属于 edge-to-runtime seam，而不是 `packages/contracts` 的一部分

## Cache And Body-Size Posture

public answer path 的默认 posture 应保持保守：

- cache semantics 必须显式，不允许默认把回答路径当作普通静态内容缓存
- body-size expectation 必须在 edge/runtime boundary 明确，而不是由 package 层隐式承受
- cache 与 body-size 规则只属于 public entry delivery contract，不属于 app-level answer semantics

## Timeout And Streaming Boundary

timeout / streaming 也属于 runtime-facing contract：

- timeout budget 必须在 edge-to-runtime seam 明确
- streaming expectation 必须定义为 runtime capability 假设，而不是 specialist 或 retrieval contract
- 后续如果 public entry 支持 streaming，这也应在 `Cloudflare -> apps/supervisor-api` seam 解决，而不是下沉进 `packages/*`

## Health And Readiness Seam

health / readiness 在这里明确属于 runtime seam：

- Cloudflare 只依赖 runtime origin 提供的 health/readiness behavior
- `apps/supervisor-api` 是 public origin 的 health/readiness surface
- specialist、retrieval、ingestion package 不直接承载 public entry health/readiness contract

## Edge Assumptions Vs Runtime Assumptions

| Concern | Edge assumption | Runtime assumption |
| --- | --- | --- |
| Forwarding | Cloudflare forwards only admitted public-entry traffic to the public origin | `apps/supervisor-api` receives public-entry traffic as the only public runtime ingress |
| Request-id / trace | Edge may preserve or project correlation metadata | Runtime may consume correlation metadata as runtime context only |
| Cache | Edge cache posture is explicit and conservative | Runtime does not assume answer-path caching by default |
| Body-size | Edge enforces or constrains public request size before origin | Runtime may assume requests are already within the documented public-entry envelope |
| Timeout / streaming | Edge and route budget are explicit before origin | Runtime handles request budget and streaming behavior after arrival |
| Health / readiness | Edge routes against origin health/readiness seam | `apps/supervisor-api` exposes the public origin seam |

## 对核心 package 的限制

这份 contract 明确不授权以下变化：

- 不把 forwarding、trace、cache、timeout、streaming、health 这些 edge/runtime concern 推入 `packages/*`
- 不修改 `packages/contracts` 来表达 edge provider metadata
- 不让 `packages/supervisor-core` 吸收 Cloudflare 或 ingress delivery 逻辑

## 与 Phase 5 的关系

Phase 04.3 不解决：

- `SupervisorRequest.actor`
- retrieval ACL
- audit closure
- app-layer auth semantics

这些仍然属于 Phase 5。

## 非目标

- 不在本 phase 实现 Cloudflare route/worker/config
- 不定义 vendor-specific tracing or logging tooling
- 不定义 panel runtime shell 行为
- 不改变 `packages/*` contract 或运行时职责
