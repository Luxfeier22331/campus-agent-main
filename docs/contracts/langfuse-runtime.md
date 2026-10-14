---
doc_type: contract
owner_boundary: runtime-observability
status: active
---

# Langfuse 运行合同

## 边界

Langfuse 消费 Agent Runtime trace，不拥有产品 HTTP、Temporal 生命周期、PostgreSQL
run projection、Hindsight bank 或评测输入来源。Langfuse 的区域、project、environment 和凭据由实际
部署环境配置决定，不在源码合同中固定。

运行 trace 是可选观测能力。环境可以因配额或成本策略停止 ingestion；这不表示产品请求失败，也
不能阻断在线执行、readiness、promotion 或 PostgreSQL 终态。只有显式 trace 校验命令使用 Langfuse
Public API。

## Runtime 集成

`apps/agent-runtime` 拥有运行 trace 的导出基础设施，包含：

- OpenAI Agents SDK 与 OpenInference instrumentation；
- 官方 `@langfuse/otel` span processor；
- 标准 Node OpenTelemetry tracer provider 和 OTLP/HTTP exporter；
- Agent Runtime 自有的 producer-side allowlist。

Agent Runtime 只在进程启动时存在 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 或
`OTEL_EXPORTER_OTLP_ENDPOINT` 时启用 exporter。endpoint、环境、release 和实际部署路径由环境配置
选择；产品请求不能选择采样率、project、endpoint 或观测模式。进程关闭时 flush，不在每个请求或
span 后强制 flush。

当前 Activity 路径直接发起单次模型请求；OpenAI 调用使用 `NoopTrace` 和 `tracing: false`，
不再由旧 Runner 自动生成完整 Agent/tool trace。配置 exporter 不能证明当前模型与工具已形成
完整 Langfuse 调用链，逐阶段定位以持久投影为准。实现见
[SDK 单次调用](../../apps/agent-runtime/src/sdk-runner.ts)与[Worker](../../apps/agent-runtime/src/worker.ts)。

入站请求的追踪上下文只服务 App API 的可选运行关联，到 durable execution 边界即终止。
agent-control 只提取和转发入站请求已有的可选 W3C `traceparent`，不从产品标识派生 trace，
也不传播 `baggage`。
agent-control 不创建 OTel exporter、编排 span 或 runtime metric；Temporal history、PostgreSQL
投影和 Hindsight 业务调用不依赖 trace export。Hindsight 不产生新的 Langfuse trace。

`traceparent` 只证明跨服务调用的可选因果关联，不承载产品或工作流状态。step `failure.code`、run
`terminal_reason`、`fail_close_reason` 和产品 `retryable` 都由各自持久合同产生，不能从 trace、
span、Langfuse 可见性或未传播的 `baggage` 推断。

Agent Runtime 直接把 Agent trace 发送到 Langfuse 云服务，不经过 Collector 中间层。Collector
已从环境仓退役；源码仓不再维护 Collector 配置。trace 发送只覆盖 Agent/OpenInference span，不接收
agent-control、Hindsight、日志或指标。环境是否启用 trace 导出由环境仓的
`OTEL_EXPORTER_OTLP_*` endpoint 决定，源码不证明某个环境已启用。

## Trace 数据

模型格式失败的可见输出诊断属于 agent-control 的内部 Ops 投影，不属于本 trace 合同；其
有界正文通过 Runtime 内部响应保存到独立诊断列，不进入 span、普通日志或外部 exporter。
该例外见 [Langfuse 调用链数据](../../.agents/notes/implemented/architecture/2026-07-15-langfuse-trace-data.md)
与[持久执行数据文档](../data/durable-runtime.md)，不启用 SDK sensitive data 导出。

Agent producer 必须保持 `traceIncludeSensitiveData=false`、OpenInference
`hideInputs=true`、`hideOutputs=true`。共享 span processor 在发送前只保留当前
Agent/OpenInference/Langfuse 所需字段，并删除未知属性、links、异常正文、stack 和 status message。

允许的内容限于：

- `user.id`、`session.id`、environment、release、固定 trace name/tag；
- 唯一的产品关联 metadata `request_id`；
- model/provider 标识、token usage、Agent/tool 名称和有界阶段结果；
- 安全错误类型，不包含原始错误正文。

`langfuse.internal.is_app_root=true` 是 Langfuse SDK 为 Root Observation 视图写入的固定布尔标记。
producer-side sanitizer 只允许严格的 `true`，拒绝其他值和其他 `langfuse.internal.*` 字段；该标记
不是产品状态、关联键或产品请求可提供的 metadata。

运行 trace 不得包含 prompt、模型输入输出、对话、工具参数或结果、memory/retrieval 正文、provider
原始响应、Authorization、Cookie、API key、密码、数据库凭据、对象存储 secret 或其他认证材料。
字段准入的可执行来源是 `apps/agent-runtime/src/telemetry-sanitizer.ts` 及其测试，不能通过 Collector
transform 恢复 producer 已删除的内容。

产品 `requestId` 是产品投影的持久业务键。W3C trace context 和 Langfuse 原生 trace ID 只承担技术
观测职责，不进入产品 API 或持久业务投影。Langfuse trace 是否存在、采样、延迟或保留状态都不能
改写产品终态。

## 评测与评分

调用方提供的 Agent case 可以按评测合同包含必要输入和 reference。评测输入由调用方、仓库文件或本地文件拥有；不得从生产 trace 正文隐式生成输入，也不通过 Langfuse 平台状态反查评测正文。

`packages/inspect-eval` 负责离线保存结果评分和通过未来的 Control/Runtime eval ingress 执行真实多轮样本。Inspect `.eval` 日志是评测结果，包含逐轮、阶段、尝试和工具评分；`score` 只重新评分保存日志，不触发产品，`eval-retry` 只由 Inspect 管理发生执行错误的样本。产品执行失败也保留为可评分样本。

Inspect 的未来 live 执行使用 agent-control 所属的专用 eval ingress，直接进入执行层，不复用 App API 的 Cookie、用户会话、用户归属或产品受理生命周期。Inspect 不代理生产模型、不安装到生产 Agent、不读取原始 Temporal history；Control/Runtime 只暴露受控步骤、尝试、工具参数和归一化结果。

Langfuse 只保留独立在线 trace 校验，不接收或发布 Inspect score。旧 Ragas 分数不迁移。

## 可用性

- 普通 trace export 是可选观测能力；Langfuse 不可用或配额停收不得阻塞在线回答。
- eval command 读取或写入失败必须使该离线命令失败。
- project、credential、Collector pipeline 或 workflow 存在不证明数据已写入或删除；需要数据事实时
  必须查询实际 project。

## 相关文档

- [运行时遥测（字段与边界）](../reference/telemetry.md)
- [Worker 发布与平台诊断](../runbooks/observability/worker-otel.md)

## 参考

- [Langfuse](../../.agents/notes/implemented/architecture/2026-07-16-langfuse.md)
- [Langfuse 调用链数据](../../.agents/notes/implemented/architecture/2026-07-15-langfuse-trace-data.md)
- Langfuse OpenTelemetry：<https://langfuse.com/docs/integrations/native/opentelemetry>
