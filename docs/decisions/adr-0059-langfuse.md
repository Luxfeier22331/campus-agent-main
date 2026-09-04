---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0059
status: accepted
---
# ADR-0059 Langfuse

## 背景

Temporal 和产品数据库可以说明请求如何执行及最终状态，但不提供模型调用观测和可选评分能力。
通用错误与日志平台也不应承担这些职责。

## 决策

采用 Langfuse Cloud 作为模型与工具调用的观测和评测平台。具体项目、区域、环境标识和凭据由部署
配置维护，不在本 ADR 固定。

- Langfuse 保存受信任的模型/工具 trace，并接收调用方按需发布的 score。
- Temporal 保存工作流执行状态；产品数据库保存请求状态和有限排查摘要。
- 运行时通过 OpenTelemetry 和平台官方集成发送 trace，并保留跨系统关联标识。
- 运行 trace 只保存受控模型/工具标识、用量、阶段结果和关联元数据；模型输入输出、对话、记忆/
  检索正文、工具原始载荷和认证材料不得进入 trace。需要正文的评测输入由调用方显式提供。
- eval runtime 可以通过官方 SDK 发布 score 和验证 trace，但评测输入、确定性合同和发布判断仍由仓库拥有。
- Langfuse SDK、字段和数据模型不得进入 `packages/contracts` 或定义产品 API。

具体 trace 字段、评测流程、部署方式和完成度由 Langfuse 所属文档、评测运行时和
部署配置维护。

## 后果

- Langfuse 不可用会降低模型调用排查和评测能力，但不得改写已持久化的产品状态。
- Ops Web 可以展示安全关联标识或入口，不镜像 observation body 或 score 状态。
- Langfuse Cloud 不改变数据所有权；仓库仍拥有确定性合同和发布判断。

## 未采用方案

- **把模型观测写入产品数据库**：会复制敏感正文和平台工作流。
- **用 Temporal 或通用日志平台替代 Langfuse**：它们不拥有模型评测生命周期。
- **让 Langfuse 决定执行或发布状态**：会把产品合同交给外部平台状态。
- **继续自托管 Langfuse**：会长期维护 Web、Worker、ClickHouse、Valkey、PostgreSQL 和对象
  存储，并占用与产品流量无关的集群资源。

## 相关文档

- `../reference/telemetry.md`
- `../contracts/langfuse-runtime.md`
- `../reference/eval.md`
- `adr-0081-observability-planes.md`
- `adr-0076-langfuse-trace-data.md`
