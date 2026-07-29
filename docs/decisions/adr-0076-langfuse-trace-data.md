---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0076
status: accepted
---
# ADR-0076：Langfuse 调用链数据

## 背景

官方 Agent instrumentation 可以把模型输入输出、对话、工具载荷和上下文序列化进 span。此类
内容同时跨越用户数据、授权投影、检索来源和供应商边界；依靠 Collector 在下游逐字扫描既不能
证明完整，也会让 Temporal、日志与模型观测采用不同的数据最小化规则。

Langfuse 仍提供调用链、数据集、评分和人工评审能力，但运行 trace 与显式评测 dataset 是不同的
数据生命周期。

## 决策

使用 Langfuse Cloud Japan 区域中的 `campus-agent` project 作为受信任的模型观测和评测平台。

- Agent producer 关闭 SDK sensitive data 导出；
- 运行 trace 只包含 user/session 关联、model/provider、agent/tool 名称、usage、阶段结果、耗时
  和有界关联 metadata；
- prompt、模型输入输出、对话、工具原始载荷、memory/retrieval 正文、provider 原始响应、认证
  材料和密钥不得进入任何运行 trace；
- App API、Ops Web、Temporal metadata 和 PostgreSQL 读取模型同样只保存各自合同允许的有界
  摘要；
- 运行时在进程启动时通过标准 OpenTelemetry 或官方集成启用发送，请求不能选择采样、发送端或
  数据接收目标；
- 仓库不建设原始生产模型调用采集、回放索引、差异存储或回放服务；
- 评测通过 Langfuse 官方的数据集、运行和评分能力关联产品调用，并使用 Ragas 等成熟评分实现；
- 需要正文的评测 case 必须经版本化输入和显式评审进入 dataset，不能从生产 trace 正文隐式生成。

## 后果

- 在线排查可以使用关联、模型、用量、阶段和低基数失败信息，但不能依赖生产 prompt 或回答
  回放；
- 评分元数据保持标量和白名单字段；dataset item 的正文只属于已准入评测 case，不属于运行
  trace；
- Langfuse 不可用不阻塞在线执行；Temporal 和 PostgreSQL 仍维护执行生命周期状态。

## 未采用方案

- **保留自研回放系统**：重复生命周期、安全、数据结构和运维能力；
- **在受信任 receiver 后保留模型输入输出**：网络隔离不能防止正文误采集、越权关联或下游泄露；
- **用实验接口重新执行已有产品调用**：会产生第二次执行和不一致的诊断证据。

## 与既有决策的关系

ADR-0059 继续拥有 Langfuse 平台；ADR-0081 继续拥有观测平面划分。ADR-0061 定义 TypeScript
所有权、Ragas Python 边界和安全评测输入。

## 相关文档

- `docs/contracts/langfuse-runtime.md`
- `docs/architecture/system/langfuse.md`
- `docs/reference/eval.md`
- `docs/runbooks/ragas.md`
