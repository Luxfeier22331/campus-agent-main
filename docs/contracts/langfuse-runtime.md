---
doc_type: contract
owner_boundary: runtime-observability
status: active
---

# Langfuse 运行合同

## 边界

Langfuse 消费 Agent Runtime trace 和评测 score，不拥有产品 HTTP、Temporal 生命周期、PostgreSQL
run projection、Hindsight bank 或评测输入来源。Langfuse 的区域、project、environment 和凭据由实际
部署环境配置决定，不在源码合同中固定。

运行 trace 是可选观测能力。环境可以因配额或成本策略停止 ingestion；这不表示产品请求失败，也
不能阻断在线执行、readiness、promotion 或 PostgreSQL 终态。只有显式评测命令使用 Langfuse
Public API。

## Runtime 集成

`apps/agent-runtime` 是当前唯一的运行 trace producer。它使用：

- OpenAI Agents SDK 与 OpenInference instrumentation；
- 官方 `@langfuse/otel` span processor；
- 标准 Node OpenTelemetry tracer provider 和 OTLP/HTTP exporter；
- Agent Runtime 自有的 producer-side allowlist。

Agent Runtime 只在进程启动时存在 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 或
`OTEL_EXPORTER_OTLP_ENDPOINT` 时启用 exporter。endpoint、环境、release 和实际部署路径由环境配置
选择；产品请求不能选择采样率、project、endpoint 或观测模式。进程关闭时 flush，不在每个请求或
span 后强制 flush。

入站请求的追踪上下文只服务 App API 的可选运行关联，到 durable execution 边界即终止。
execution-control 只提取和转发入站请求已有的可选 W3C `traceparent`，不从产品标识派生 trace，
也不传播 `baggage`。
execution-control 不创建 OTel exporter、编排 span 或 runtime metric；Temporal history、PostgreSQL
投影和 Hindsight 业务调用不依赖 trace export。Hindsight 不产生新的 Langfuse trace。

`traceparent` 只证明跨服务调用的可选因果关联，不承载产品或工作流状态。step `failure.code`、run
`terminal_reason`、`fail_close_reason` 和产品 `retryable` 都由各自持久合同产生，不能从 trace、
span、Langfuse 可见性或未传播的 `baggage` 推断。

源码本地 Collector 只有一个 Agent trace pipeline：debug 配置写 debug exporter，prodlike 配置写
Langfuse。它不接收 execution-control、Hindsight、日志或指标。环境部署
是否使用 Collector 由环境仓决定，源码配置存在不证明某个环境已启用。

## Trace 数据

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

调用方提供的 Agent case 可以按评测合同包含必要输入和 reference。评测输入由调用方、仓库文件或
本地文件拥有；不得从生产 trace 正文隐式生成输入，也不通过 Langfuse 平台状态反查 Ragas 正文。
仓库不维护 Langfuse dataset manifest、镜像同步或 reconciliation 控制面。

产品路径评测分为三个显式阶段：

1. `agent-eval` 读取调用方提供的 cases 文件，可选执行 setup turn，通过真实 App API 执行目标 turn，
   按 `requestId` 读取 `agent_runtime_eval_projection.v5`，写出 `agent_product_eval_result.v3`；
2. `score-ragas` 读取该产品结果，在本地临时构造 Agent sample 和 `ragas_sample_batch.v3`，调用
   Ragas runner，写出最终 score 文件；
3. `publish-scores` 按 `case_id` 使用调用方显式提供的原生 Langfuse trace ID 映射，并通过官方 SDK
   的 `score.create` 和一次 `score.flush` 发布可选 Langfuse score。

第一阶段不访问 Langfuse；第二阶段不访问 Langfuse；第三阶段只发布 score，不创建第二条产品 trace，
也不创建或维护 Dataset Run。`packages/eval-langfuse` 验证在线 trace 时只要求 metadata 中唯一的
产品 `request_id`，不要求 execution-control workflow metadata。

Ragas runner 不连接 Langfuse、不选择平台数据、不从 trace 读取正文，也不携带 trace、observation 或
平台运行字段。未知 score 名称、缺失 case 关联、非有限数值或 Langfuse 写入失败必须使发布命令失败；
score 名称由代码级 allowlist 校验，不再同步独立 score registry。

独立离线 Ragas 可以完全不连接 Langfuse；其结果默认留在 stdout 或调用方指定的本地文件。普通 trace
不能被命令反查成 Ragas 正文输入。

## 可用性

- 普通 trace export 是可选观测能力；Langfuse 不可用或配额停收不得阻塞在线回答。
- eval command 读取或写入失败必须使该离线命令失败。
- project、credential、Collector pipeline 或 workflow 存在不证明数据已写入或删除；需要数据事实时
  必须查询实际 project。

## 参考

- `../decisions/adr-0059-langfuse.md`
- `../decisions/adr-0076-langfuse-trace-data.md`
- Langfuse OpenTelemetry：<https://langfuse.com/docs/integrations/native/opentelemetry>
