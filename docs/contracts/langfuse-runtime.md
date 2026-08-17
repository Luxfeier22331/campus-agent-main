---
doc_type: contract
owner_boundary: runtime-observability
status: active
---

# Langfuse 运行合同

## 边界

Langfuse 消费已准入的 Agent Runtime trace 和评测 score，不拥有产品 HTTP、Temporal 生命周期、
PostgreSQL run projection、Hindsight bank 或仓库 dataset 真相。所有环境使用 Langfuse Cloud Japan
区域中的 `campus-agent` project，并通过原生 `environment` 字段区分 local、staging 和 production。

运行 trace 是可选观测能力。环境可以因配额或成本策略停止 ingestion；这不表示产品请求失败，也
不能阻断在线执行、readiness、promotion 或 PostgreSQL 终态。新流程只在显式评测命令中使用
Langfuse Public API；execution-control 暂时保留的 maintenance client 只服务兼容版本上线前已启动的
`owner_erase` history，不接受新命令。

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

浏览器和 Sentry 的追踪上下文只服务 App API 入站错误观测，到 durable execution 边界即终止。
Source 使用产品 `traceId` 生成该次 durable execution 唯一允许的 W3C `traceparent`；
execution-control 只提取和转发这个上下文，不转换 `sentry-trace`，也不传播 `baggage`。
execution-control 不创建 OTel exporter、编排 span 或 runtime metric；Temporal history、PostgreSQL
投影和 Hindsight 业务调用不依赖 trace export。Hindsight 不产生新的 Langfuse trace。

源码本地 Collector 只有一个 Agent trace pipeline：debug 配置写 debug exporter，prodlike 配置写
Langfuse。它不向 Axiom 复制 trace，也不接收 execution-control、Hindsight、日志或指标。环境部署
是否使用 Collector 由环境仓决定，源码配置存在不证明某个环境已启用。

## Trace 数据

Agent producer 必须保持 `traceIncludeSensitiveData=false`、OpenInference
`hideInputs=true`、`hideOutputs=true`。共享 span processor 在发送前只保留当前
Agent/OpenInference/Langfuse 所需字段，并删除未知属性、links、异常正文、stack 和 status message。

允许的内容限于：

- `user.id`、`session.id`、environment、release、固定 trace name/tag；
- `request_id`、`run_id`、`trace_id`、`turn_id` 四个关联 metadata；
- model/provider 标识、token usage、Agent/tool 名称和有界阶段结果；
- 安全错误类型，不包含原始错误正文。

`langfuse.internal.is_app_root=true` 是 Langfuse SDK 为 Root Observation 视图写入的固定布尔标记。
producer-side sanitizer 只允许严格的 `true`，拒绝其他值和其他 `langfuse.internal.*` 字段；该标记
不是产品状态、关联键或产品请求可提供的 metadata。

运行 trace 不得包含 prompt、模型输入输出、对话、工具参数或结果、memory/retrieval 正文、provider
原始响应、Authorization、Cookie、API key、密码、数据库凭据、对象存储 secret 或其他认证材料。
字段准入的可执行来源是 `apps/agent-runtime/src/telemetry-sanitizer.ts` 及其测试，不能通过 Collector
transform 恢复 producer 已删除的内容。

产品 `requestId` 是日志和产品投影的持久业务键；传输层 trace ID 不承担业务标识职责，产品
`traceId` 只用于关联和展示。Langfuse trace
是否存在、采样、延迟或保留状态都不能改写产品终态，也不能要求 Ops Web 同时用两个 ID 过滤 Axiom
application logs。

## 数据集与评分

Langfuse dataset 是独立评测数据生命周期。经评审导入的版本化 case 可以按评测合同包含必要输入和
reference；不得从生产 trace 正文隐式生成 dataset item，也不得借 dataset API 绕过运行 trace 的
正文禁令。

评测通过真实产品路径执行。每个目标 turn：

1. 可选 setup turn 在同一 conversation 中依次执行；
2. runner 读取完成 run 的 `agent_runtime_eval_projection.v3`；
3. 从 product trace identity 解析 runtime Langfuse trace；
4. 调用 `/api/public/dataset-run-items` 关联真实 trace；
5. 保留 Langfuse 返回的 dataset run identity；
6. 调用 Ragas runner 并发布已登记 score。

因为产品请求已经生成 canonical trace，runner 不使用 `runExperiment` 创建第二条 trace。
`packages/eval-langfuse` 验证 trace 时要求唯一的 `request_id`、`run_id`、`trace_id` 和
`turn_id`，不要求 execution-control workflow metadata。

`packages/eval-langfuse` 通过 `POST /api/public/scores` 同步发布。每个 payload 只能指向一个
observation，若无 observation 则指向一个 trace。dataset item/run ID 不属于 score target。未知
名称、缺失关联、非有限数值或 Langfuse 写入失败必须使离线命令失败；metadata 只允许标量白名单，
答案和 context text 不进入 score metadata。

## 可用性

- 普通 trace export 是可选观测能力；Langfuse 不可用或配额停收不得阻塞在线回答。
- eval command 读取或写入失败必须使该离线命令失败。
- project、credential、Collector pipeline 或 workflow 存在不证明数据已写入或删除；需要数据事实时
  必须查询实际 project。

## 参考

- Langfuse OpenTelemetry：<https://langfuse.com/docs/integrations/native/opentelemetry>
