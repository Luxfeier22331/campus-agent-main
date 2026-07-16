---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0077
status: accepted
---
# ADR-0077 Temporal 采集

## 背景

仓库曾积累 source-specific HTTP lifecycle route、PostgreSQL run ledger、task lease/closeout
model、adapter callback 和 v2 task envelope，重复 Temporal 职责。这些路径让 app-api、
ingestion-control 和 collector 共同拥有 workflow，也让 artifact storage location 隐式存在。

## 决策

每个 ingestion task 都是由 `apps/ingestion-control` 启动的一个 Temporal workflow。

- `ingestion_task_envelope.v3` 只包含 task/run identity、registry task id 和 SHA-256-pinned
  object-store input ref。
- `ingestion_task_registry.v3` 在 workflow start 前固定 executor、source/target identity 和
  input/output contract。
- active executor 只有 `source_collector` 和 `rust_kernel`。
- `source_collector` activity 在 `apps/source-collector` 运行；Rust kernel 通过
  ingestion-control bridge 调用 `packages/ingestion-kernels-rs`。
- 一个 activity 只返回一个 `ingestion_task_result.v1` ref 和有界 summary；详细 output
  保存在 object storage。
- Temporal 拥有 durable state、retry、timeout、heartbeat、cancellation 和 task dispatch。
  PostgreSQL 只保存有界 task projection 和最新 official-web URL freshness state。
- 来源特定的 lifecycle endpoint、run ledger、target-workset callback、app-api collector route
  和 Python fallback executor 均不存在。
- source capture 可以输出确定性 classification metadata，但不执行 downstream admission、
  multimodal processing、projection rebuild 或 query-serving read-model materialization。
- official-web capture 保持 offline；完整 publication chain 独立实现并开放前不能
  query-enable。

长 activity 使用 Temporal Activity heartbeat 报告粗粒度进度，不发送大量 workflow
signal 或写 progress row。input、preparation、observation 和 terminal output 都以
digest-pinned object ref 跨运行时传递。

## 后果

- workflow history 保持有界且可 replay。
- retry 和 cancellation 只有一个所有者。
- collector 可以更换 Crawlee/provider 内部实现而不改变 task contract。
- task 不能从 mutable request field 推断 source、target、executor 或 output contract。
- 恢复 source-specific route/ledger 需要新 ADR，不能作为 compatibility path 添加。

## 参考

- [Temporal Activities](https://docs.temporal.io/activities)
- [Temporal Activity heartbeats](https://docs.temporal.io/encyclopedia/detecting-activity-failures#activity-heartbeat)
- [Temporal cancellation](https://docs.temporal.io/develop/typescript/cancellation)
- `docs/architecture/system/data-plane.md`
- `docs/runbooks/ingestion.md`
