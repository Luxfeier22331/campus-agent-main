---
doc_type: state
status: backlog
created: 2026-04-23
updated: 2026-04-23
---

# State: Supervisor Docker Runtime Language Split

## Current Status

- status: `backlog`
- current slice: none
- owner: unassigned
- active implementation: no

## Captured Context

2026-04-23 讨论结论：

- 用户明确本问题不涉及 Worker 侧选型；范围是 Docker 部署部分。
- 用户关切点是 Python 性能差、服务器预算有限。
- 结论不是“所有 tool 改 Rust”，而是按负载拆分：
  - Go execution shell 承接高并发 transport / admission / streaming / cancellation /
    coalescing / metrics。
  - Rust CPU kernels 承接经 profiling 证明的 parser / normalizer / diff / ranking /
    projection hot path。
  - Python orchestration 保留现有 supervisor-led multi-agent 语义，并按证据逐步替换。
- 当前 repo 文档已明确 `apps/supervisor-api` 为 Docker-first internal execution
  service，但不冻结为单一 Python/HTTP framework。

## Blockers

- 缺少 Docker 侧真实 profiling / tracing 数据。
- chat capacity / cancellation backlog 尚未 active；它会影响 Go shell 的 admission、
  cancellation、coalescing 与 backpressure contract。
- 尚未确定正式容量目标、服务器规格、K8s/多实例策略和成本上限。

## Verification

- 本 backlog 捕获来自架构讨论与代码/文档核对；未执行实现验证。
- 恢复为 active 后，第一步必须补 profiling baseline，而不是直接重写 runtime。

## Continuity Notes

- 不把语言选择写入 `packages/contracts`。
- 不把 thin tool adapter 当成 Rust 迁移首选目标。
- 如果引入 Go shell，应优先服务于 admission、cancellation、streaming、coalescing 与 metrics。
- 如果引入 Rust，应优先服务于可独立 benchmark 的 CPU-heavy kernel。
