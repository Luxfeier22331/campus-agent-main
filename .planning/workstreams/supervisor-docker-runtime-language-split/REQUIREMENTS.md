---
doc_type: requirements
status: backlog
created: 2026-04-23
updated: 2026-04-23
---

# Requirements: Supervisor Docker Runtime Language Split

## Goal

在预算受限、Docker-first 部署的前提下，为 `supervisor-api` 与内部执行服务建立可验证的
runtime 拆分路线：Go 承接高并发 execution shell，Rust 承接经 profiling 证明的
CPU-heavy kernels，Python orchestration 保留并按证据逐步替换。

## Captured Context

- Worker 侧 runtime 选型已确定，不在本 workstream 范围内。
- `apps/supervisor-api` 的部署 substrate 已冻结为 Docker-first internal execution
  service，但 repo 文档明确没有冻结为单一 Python/HTTP framework。
- 当前 `supervisor-api` 是 Python 3.12+，ASGI shell 通过 thread pool 包装同步
  `handle_request`，默认 answer admission 为 8 并发槽。
- 预算受限时，单纯堆 Python worker / 线程不是长期容量策略。
- 多 agent 校园问答的主要成本和延迟仍可能来自 LLM 请求、token、retrieval I/O、
  provider rate limit 与热点流量；语言迁移必须基于 tracing/profiling，而不是先重写便宜
  adapter。

## Target Split

- Go execution shell
  - transport server
  - admission / lane budgets
  - streaming / cancellation
  - request coalescing / backpressure
  - metrics / health / readiness
- Rust CPU kernels
  - parser / normalizer
  - diff / hash / validation
  - ranking / scoring hot path
  - projection builder hot loop
- Python orchestration
  - 保留现有 supervisor / specialist orchestration 语义
  - 只在 profiling 证明本地 orchestration 成为瓶颈后逐步替换
  - 迁移期间通过 stable JSON / contract seam 隔离运行时

## In Scope

- `supervisor-api` Docker runtime profiling、stage-level latency tracing、
  CPU/RSS 指标与容量基线
- Go execution shell 的 contract、admission、cancellation、streaming、observability 设计
- Rust CPU kernel 的候选清单、FFI/CLI/service seam 评估与基准门槛
- Python orchestration 的保留边界、可替换 seam 与渐进迁移策略
- 多实例/K8s 场景下的成本、pod sizing、HPA 指标与 rollout/runback 策略

## Non-goals

- 重写 Worker 侧 `app-api` / web surfaces
- 默认把所有 `tool_adapter` 改成 Rust
- 因语言迁移改写 `packages/contracts` 的基础设施无关边界
- 把 product-layer auth/session/rate-limit/request projection 下放到 `supervisor-core`
- 在没有 tracing/profiling 证据前进行大规模语言重写

## Success Criteria

1. 能用真实或回放流量量化 Python execution shell、LLM 请求、retrieval I/O 与 CPU-hot
   path 的耗时/资源占比。
2. 如果 Go shell 被 admission，必须有稳定的 internal execution contract、取消语义、
   streaming 语义、backpressure 语义和 metrics 语义。
3. 如果 Rust kernel 被 admission，必须证明目标路径 CPU-bound，并通过稳定 JSON/CLI/service
   seam 接入，不污染 `packages/contracts`。
4. Python orchestration 的保留/替换边界可逐步执行，且不改变 supervisor-led multi-agent
   架构。
5. 迁移计划包含 Docker image、deployment、rollback、observability 与容量预算。
6. 任何语言替换都必须通过基准、回归测试和线上容量证据关闭，不以“Python 性能差”作为唯一依据。
