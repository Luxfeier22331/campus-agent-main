---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0076
status: accepted
---
# ADR-0076 Langfuse Trace 数据

## 背景

raw replay 设计重复了 self-hosted Langfuse trace、dataset 和 score platform 已有能力，还
引入 custom capture policy、replay packet schema、fingerprint、object-store lifecycle 和
product database column，却没有迁移或兼容需求。

另一方面，完全禁止 Langfuse 保存模型输入输出、memory 和 retrieved fact，会让 LLM
observability 无法看到需要排查的真实执行。

## 决策

使用自托管 Langfuse 作为受信任内部 LLM observability plane。

- sampled Agent SDK trace 可以包含 user/session association、model input/output、memory
  context 和已授权 retrieved fact。
- credential 和 secret 在所有 trace/eval lane 中都禁止出现。
- app-api、Ops Web、Temporal metadata 和 PostgreSQL read model 只保存有界
  projection，不复制 Langfuse observation body。
- tracing 在进程启动时通过标准 OTel exporter config 启用；request 不携带 observability
  mode、sample ratio、exporter setting 或 sink ref。
- 自定义原始采集策略、回放 packet/index/diff schema、LLM I/O/answer fingerprint、回放服务和
  database column 全部退役。
- badcase reproduction 通过真实产品路径重新运行版本化 Langfuse dataset item。
- eval adapter 使用官方 dataset-run-item API 关联 product trace，并使用返回的 dataset run
  identity 执行 Ragas 和确定性 score。
- 已有真实 product trace 时不使用 `runExperiment`，避免产生第二个 synthetic trace。

## 后果

- request tracing 启用时，OpenAI Agents SDK instrumentation 包含 model I/O。
- 产品观测保持紧凑，只保存 correlation identity、model/provider identity、
  `agent_runtime_prompt_trace.v1` 和 stage timing。
- score metadata 保持 scalar 且 allowlisted；answer/context text 属于 trace、dataset 和 Ragas
  sample field。
- Langfuse 不可用不阻塞在线执行；Temporal 和 PostgreSQL 仍是 lifecycle truth。
- Ragas 保持窄 Python island；TypeScript 拥有产品执行、dataset linking 和 score publication。

## 未采用方案

- **保留 custom replay plane**：无兼容消费者却重复 lifecycle、安全、schema 和运维。
- **Langfuse 禁用 model I/O**：metadata-only span 无法排查 prompt、memory、retrieval 或
  model output。
- **用 `runExperiment` 包裹产品调用**：产品调用已产生 canonical trace，不应合成第二次
  execution。

## 与既有决策的关系

ADR-0059 继续拥有 Langfuse 平台；本决策修订其中 sanitized-trace-only 表述。ADR-0061、
ADR-0062 继续定义 TypeScript 所有权、Ragas Python island 和安全 sample/score shape。

## 相关文档

- `docs/contracts/langfuse-runtime.md`
- `docs/architecture/system/langfuse.md`
- `docs/reference/eval.md`
- `docs/runbooks/ragas.md`
