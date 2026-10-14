# Agent Note: Langfuse 调用链数据

Status: implemented

评测框架、旧分数与 Langfuse score 发布部分已由 [Inspect AI 接入](../testing/2026-10-13-inspect-agent-evaluation.md)取代；
以下保留原取舍，输入来源、线上 trace 与生产模型配置的独立边界继续有效。当前入口见
[Inspect 评测](../../../../docs/runbooks/inspect.md)。

## 背景

官方 Agent instrumentation 可以把模型输入输出、对话、工具载荷和上下文序列化进 span。此类
内容同时跨越用户数据、授权投影、检索来源和供应商边界；依靠 Collector 在下游逐字扫描既不能
证明完整，也会让 Temporal、日志与模型观测采用不同的数据最小化规则。

Langfuse 提供调用链和评分能力；运行 trace 与调用方显式提供的离线评测输入属于不同数据生命周期。

## 决策

使用 Langfuse Cloud 作为受信任的模型观测和评测平台。具体项目、区域、环境标识和凭据由部署配置
维护，不在本笔记 固定。

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
- 产品评测完成后可通过官方 SDK 将 score 发布到已有产品 trace；仓库不维护 Langfuse dataset 镜像
  或同步控制面；
- 需要正文的评测输入由调用方显式提供，不能从生产 trace 正文隐式生成；普通 trace 不能被反查为
  Ragas 正文输入；
- Ragas runner 只读取平台无关的本地 JSON；trace 身份只在 TypeScript 适配层用于可选 score 发布。

## 未采用方案

- **保留自研回放系统**：重复生命周期、安全、数据结构和运维能力；
- **在受信任 receiver 后保留模型输入输出**：网络隔离不能防止正文误采集、越权关联或下游泄露；
- **用实验接口重新执行已有产品调用**：会产生第二次执行和不一致的诊断证据。

## 后果

### 内部模型格式失败诊断的例外

Executor 检索成功后发生输出格式错误的实际请求证明，仅保留错误码不能定位坏文本。
允许 Agent Runtime 为 `model_output_invalid` 向 Agent Control 返回有界可见失败文本，保存到
步骤结果的独立诊断列供现有 Ops 读取。该例外不属于运行 trace，也不建立全量采集或回放系统。
该诊断列不保存 thinking、prompt、原始 SDK 响应或认证材料，也不把诊断正文注入 Temporal、
聊天事件或后续模型上下文。它与 Control 用于恢复的私有单模型 `TurnRecord` receipt 不同：后者
可以保存模型输出和 provider continuation，不能据此声称运行时丢弃了全部正文。私有载荷边界见
[持久运行数据](../../../../docs/data/durable-runtime.md)和
[编排拆分决策](./2026-10-10-agent-orchestration-memory-services.md)。
两类数据都不导出到外部 trace、普通日志或公共运行事件。诊断列沿用 Ops 访问边界和请求删除生命周期；
诊断缺失不阻塞业务，不自动重试或重新执行历史请求补录。

- 在线排查可以使用关联、模型、用量、阶段和低基数失败信息，但不能依赖生产 prompt 或回答
  回放；
- 评分元数据保持标量和白名单字段；评测输入正文不属于运行 trace，也不是普通离线 Ragas 的隐式
  事实来源；
- Langfuse 不可用不阻塞在线执行；Temporal 和 PostgreSQL 仍维护执行生命周期状态。
- 当前 OpenAI 单模型调用使用 `NoopTrace` 与 `tracing: false`；配置了 exporter 不代表在线模型调用链
  已完整导出，覆盖范围以[遥测说明](../../../../docs/reference/telemetry.md)为准。

## 与既有决策的关系

[Langfuse](./2026-07-16-langfuse.md) 继续拥有 Langfuse 平台；[可观测数据边界](./2026-07-17-observability-planes.md) 继续拥有观测平面划分；[评测数据与平台边界](../testing/2026-08-21-eval-boundaries.md) 定义评测输入、
Ragas 和 Langfuse 之间的数据流。

## 相关文档

- [Langfuse 运行合同](../../../../docs/contracts/langfuse-runtime.md)
- [运行时遥测](../../../../docs/reference/telemetry.md)
- [评测](../../../../docs/reference/eval.md)
- [Inspect 评测](../../../../docs/runbooks/inspect.md)
- [评测数据与平台边界](../testing/2026-08-21-eval-boundaries.md)
