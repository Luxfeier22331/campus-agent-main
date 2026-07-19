---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0076
status: accepted
---
# ADR-0076：Langfuse 调用链数据

## 背景

为模型调用另建回放系统会重复 Langfuse 已有的调用链、数据集和评分能力，并增加第二套采集、
存储和关联模型。另一方面，如果 Langfuse 只能保存清理后的元数据，就无法排查模型输入输出、
记忆上下文和检索事实。

## 决策

使用自托管 Langfuse 作为受信任的内部模型观测和评测平台。

- 采样后的 Agent 调用链可以包含用户与会话关联、模型输入输出、记忆上下文和已授权检索事实；
- 认证凭据和密钥不得进入调用链、数据集或评分；
- App API、Ops Web、Temporal 元数据和 PostgreSQL 读取模型只保存有界摘要，不复制 Langfuse
  observation 正文；
- 运行时在进程启动时通过标准 OpenTelemetry 或官方集成启用发送，请求不能选择采样、发送端或
  数据接收目标；
- 仓库不建设第二套原始模型调用采集、回放索引、差异存储或回放服务；
- 评测通过 Langfuse 官方的数据集、运行和评分能力关联产品调用，并使用 Ragas 等成熟评分实现；
- 已经存在真实产品调用链时直接关联该调用链，不为评测重复执行产品请求。

## 后果

- 启用模型调用链后，受信任的 Langfuse 数据可以包含排查所需正文；通用日志和产品投影仍保持
  有界且不保存这些正文；
- 评分元数据保持标量和白名单字段，回答与上下文正文属于调用链、数据集和评分样本；
- Langfuse 不可用不阻塞在线执行；Temporal 和 PostgreSQL 仍维护执行生命周期状态。

## 未采用方案

- **保留自研回放系统**：重复生命周期、安全、数据结构和运维能力；
- **禁止 Langfuse 保存模型输入输出**：只有元数据的调用链无法排查提示词、记忆、检索和输出；
- **用实验接口重新执行已有产品调用**：会产生第二次执行和不一致的诊断证据。

## 与既有决策的关系

ADR-0059 继续拥有 Langfuse 平台；本决策修订其中只保存清理后元数据的表述。ADR-0061 定义
TypeScript 所有权、Ragas Python 边界和安全评测输入。

## 相关文档

- `docs/contracts/langfuse-runtime.md`
- `docs/architecture/system/langfuse.md`
- `docs/reference/eval.md`
- `docs/runbooks/ragas.md`
