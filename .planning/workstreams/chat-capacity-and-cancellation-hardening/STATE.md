---
doc_type: state
status: backlog
created: 2026-04-23
updated: 2026-04-23
---

# State: Chat Capacity And Cancellation Hardening

## Current Status

- status: `backlog`
- current slice: none
- owner: unassigned
- active implementation: no

## Captured Context

2026-04-23 代码级确认：

- 单个 `supervisor-api` 实例默认 `transport_max_concurrent_answers=8`，超限直接 `503 transport_saturated`。
- `app-api` 当前只有 durable accept 后的 abuse throttle 与 idempotency-key replay，不具备入口级容量限流、全局并发预算、热点合并或热点答案缓存。
- `public-chat-web` 当前提交后会进入 `submitted` 并显示 stop button，但 `stop()` 只切 UI 状态，不 abort fetch，也不阻止旧响应回写 UI。
- public chat 每次提交生成新的 `idempotency-key`，普通重复点击不会天然复用同一个 key。
- 后端 request lifecycle 当前没有 `cancelled` 状态或 cancel endpoint。

## Blockers

- 需要产品决定是否把 100 人同时提问作为正式容量目标。
- 需要部署决定是否进入 K8s/多实例容量治理设计。
- 需要决定同步问答之外是否接受异步长任务体验。

## Verification

- 本 backlog 捕获来自代码审查与架构讨论；未执行实现验证。
- 恢复为 active 后，至少需要覆盖 `public-chat-web` unit/component tests、`app-api` route/service tests、`supervisor-api` admission tests 与容量 smoke。

## Continuity Notes

- 不要把这条线实现成 `supervisor-api` 内部长同步队列。
- 优先处理 public chat in-flight control 与 `app-api` product-layer ingress gate。
- lane admission 必须保持 `apps/supervisor-api` transport/runtime boundary，不把 admission 逻辑塞进 `packages/supervisor-core`。
