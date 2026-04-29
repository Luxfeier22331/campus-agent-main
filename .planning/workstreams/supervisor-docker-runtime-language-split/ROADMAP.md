---
doc_type: roadmap
status: backlog
created: 2026-04-23
updated: 2026-04-23
---

# Roadmap: Supervisor Docker Runtime Language Split

当前为 backlog draft，不代表 active execution order。恢复为 active workstream 前，应重新确认
部署预算、容量目标、profiling 数据与 chat capacity hardening 的推进状态。

## Phase 1: Runtime Profiling Baseline

**Goal:** 建立 Docker 侧性能事实，避免无证据语言重写。

**Scope:**

- stage-level latency tracing
- CPU / RSS / thread / connection pool metrics
- LLM / retrieval / local orchestration 耗时拆分
- 100-user burst replay 或等价容量 smoke

## Phase 2: Go Execution Shell Design

**Goal:** 评估并冻结 Go shell 应承担的 transport/runtime 职责。

**Scope:**

- internal execution HTTP/gRPC contract
- admission / lane budgets
- cancellation / streaming
- coalescing / backpressure
- readiness / metrics / deploy lifecycle

## Phase 3: Rust CPU Kernel Candidates

**Goal:** 只为经 profiling 证明 CPU-bound 的路径设计 Rust kernel。

**Scope:**

- parser / normalizer candidates
- ranking / scoring candidates
- projection builder hot loop candidates
- CLI / service / FFI seam comparison
- benchmark threshold and rollback rule

## Phase 4: Python Orchestration Seam Hardening

**Goal:** 保留当前 supervisor-led orchestration 语义，同时明确可替换边界。

**Scope:**

- stable JSON handoff between shell and orchestration
- cooperative cancellation hooks
- prompt/retrieval execution boundary
- regression tests for multi-agent routing semantics

## Phase 5: Migration And Rollout Plan

**Goal:** 形成可部署、可回滚、可观测的分阶段迁移计划。

**Scope:**

- Docker image and compose/K8s shapes
- cost and pod sizing model
- canary / shadow / rollback strategy
- compatibility window and deprecation rules
- acceptance benchmark and production SLO gate
