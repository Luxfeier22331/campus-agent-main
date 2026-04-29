---
doc_type: requirements
status: backlog
created: 2026-04-23
updated: 2026-04-23
---

# Requirements: Chat Capacity And Cancellation Hardening

## Goal

为 public chat 的实时校园问答路径补齐容量治理、热点削峰、重复提交去重与用户中止语义，使系统能够在多 agent 校园问答场景下更稳地承接短时高峰，而不是只依赖单实例 `supervisor-api` 的 fail-fast admission。

## Captured Gaps

1. `app-api` 没有入口级容量限流；`/api/chat/requests` 前置没有产品层 `429 / Retry-After` gate。
2. `app-api` 没有全局实时问答并发预算，挡不住 100 个不同用户各发 1 次请求同时打到 `supervisor-api`。
3. `app-api` 没有热点问题合并；相同或相似问题不会 coalesce 成一次 supervisor 调用。
4. `app-api` 没有热点答案缓存；高峰时重复校园问题不能直接复用短 TTL 结果。
5. `supervisor-api` 只有全局 admission，默认 8 个并发槽，没有按 `rag-agent`、`campus-services-agent`、`notice-agent`、`navigation-agent` 做 lane 配额。
6. `supervisor-api` 没有横向扩容运行策略闭环；K8s/HPA 指标、`minReplicas`、饱和指标和容量预算尚未落地。
7. `public-chat-web` 的 stop 只是 UI 状态切换，不会 abort 当前 fetch。
8. `public-chat-web` stop 后没有忽略旧响应；旧请求返回后仍可能覆盖当前 messages。
9. `public-chat-web` 同一次提交没有稳定 idempotency 生命周期；每次 `submitChatRequest` 都生成新 key。
10. 后端没有用户取消语义；`app-api` request status 没有 `cancelled`，也没有 cancel endpoint，`supervisor-api` 没有 cooperative cancellation contract。

## In Scope

- public chat in-flight request controller、stable idempotency key lifecycle 与 stop/abort UI 语义
- `app-api` 产品层容量 gate、用户级限流响应语义、`Retry-After` 与 duplicate submit protection
- 热点问题合并、短 TTL answer cache 或等价的 spike smoothing 机制
- `supervisor-api` per-agent / per-workload lane admission 与 typed saturation observability
- K8s / 多实例容量治理所需的指标、预算与 runbook
- 用户取消后的 request lifecycle、projection semantics 与后端 cooperative cancellation 可行性评估

## Non-goals

- 在 `supervisor-api` 进程内新增长时间同步问答队列
- 把产品层身份、限流、会话或请求投影逻辑移入 `packages/supervisor-core`
- 用热点缓存回答权限受限、个性化或强上下文依赖问题
- 把非实时长任务队列伪装成当前同步 chat API
- 重开 unrelated public docs、panel、notice ingestion 或 retrieval quality workstreams

## Success Criteria

1. public chat 的重复提交不会产生多个实际执行请求；同一次提交拥有稳定 idempotency lifecycle。
2. 用户点击 stop 后，前端至少能 abort 当前 browser request 并保证旧响应不会再覆盖 UI。
3. `app-api` 可以在 product layer 对实时问答入口做明确的容量/用户级限流，并返回稳定错误语义。
4. 高峰热点问题具备合并或短 TTL 复用策略，且权限/个性化边界明确。
5. `supervisor-api` 的 admission 从单一全局槽位扩展为可观测的 workload lane budget，避免慢路径拖死快路径。
6. 多实例/K8s 部署有明确的扩容指标、`minReplicas` 预算与 saturation runbook。
7. 如果引入 cancel endpoint 或 `cancelled` request status，其语义同步反映在 request projection / operator observability 中。
8. 所有新增机制都有测试覆盖，并且不回退当前 `supervisor-led multi-agent` 边界。

## Canonical Entry

- `.planning/workstreams/chat-capacity-and-cancellation-hardening/README.md`
