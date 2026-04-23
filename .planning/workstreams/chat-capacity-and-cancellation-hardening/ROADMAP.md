---
doc_type: roadmap
status: backlog
created: 2026-04-23
updated: 2026-04-23
---

# Roadmap: Chat Capacity And Cancellation Hardening

当前为 backlog draft，不代表 active execution order。恢复为 active workstream 前，应重新确认产品目标、部署 substrate 与容量目标。

## Phase 1: Public Chat In-flight Control

**Goal:** 补齐 ChatGPT 式提交/中止体验的真实前端语义。

**Scope:**
- `AbortController` / request token
- stop 后 abort browser fetch
- stop 后忽略旧响应
- 同一次提交稳定 idempotency key
- duplicate submit UI guard

## Phase 2: App-api Ingress Capacity Gate

**Goal:** 在 product layer 为 `/api/chat/requests` 增加可解释的容量/用户级限流。

**Scope:**
- 入口级 capacity gate
- `429 / Retry-After` 响应语义
- 与现有 abuse throttle / request projection 的关系
- public chat 错误展示与 retry copy

## Phase 3: Hotspot Coalescing And Cache Policy

**Goal:** 针对校园热点问题建立安全的削峰机制。

**Scope:**
- 相同/相似问题 in-flight coalescing
- 短 TTL answer cache
- 权限、个性化、conversation context 的 cache exclusion policy
- operator observability / diagnostics

## Phase 4: Supervisor Workload Lane Admission

**Goal:** 让 `supervisor-api` 的 admission 从全局槽位升级为可观测的 workload lane budget。

**Scope:**
- `rag-agent` / `notice-agent` / `campus-services-agent` / `navigation-agent` lane budget
- 快慢路径隔离
- typed saturation reason
- `/readyz` 与 metrics exposure

## Phase 5: Scale-out Runbook And Cancellation Contract

**Goal:** 固化多实例/K8s 容量治理与后端取消语义。

**Scope:**
- HPA / minReplicas / saturation metrics
- 下游 LLM、retrieval backend、Postgres 与 object storage 容量预算
- optional cancel endpoint / `cancelled` lifecycle
- async long-task boundary decision
