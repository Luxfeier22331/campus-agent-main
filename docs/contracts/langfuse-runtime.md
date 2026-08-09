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
不能阻断在线执行、readiness、promotion 或 PostgreSQL 终态。Langfuse Public API 仍用于显式评测
命令和个人数据清除维护。

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

execution-control 不创建 OTel exporter、编排 span 或 runtime metric。它保留 W3C `traceparent` 与
`baggage` 的提取和转发，使 Agent Runtime 能继承调用上下文；Temporal history、PostgreSQL 投影和
Hindsight 业务调用不依赖 trace export。Hindsight 不产生新的 Langfuse trace。

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

产品 `requestId` 是日志和产品投影的持久业务键；`traceId` 只用于关联和展示。Langfuse trace
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

## 个人数据清除

execution-control core worker 使用以下配置访问同一 project 的 Public API：

- `LANGFUSE_BASE_URL`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`

部署的 core activity 必须同时配置三项；任何一项缺失都是启动配置错误。maintenance client 使用
HTTP Basic auth，base URL 必须是没有内嵌 credential 的 Langfuse Cloud HTTP(S) origin。

个人记忆全量清除同时处理两类已有数据：

- 按 command 冻结的产品 `UserID` 和 `source_updated_at` 上界删除 Agent/runtime trace；
- 按已退役 generation 派生的 bank identity 删除历史 Hindsight trace。

Hindsight 已停止生产新 trace，但历史数据仍属于用户删除合同，不能删除对应查询。runtime 查询
故意覆盖该用户在 command 上界内的全部 trace，不得按 conversation、request、tag 或 observation
名称缩窄；上界之后的新 runtime trace 不得被删除。历史 Hindsight 查询不加时间上界，因为 generation
fence 已阻止退役 bank 接收新业务调用。

purge 使用 `fields=core`、`orderBy=timestamp.asc`，每页最多取 100 个 trace ID，最多读取 1000 页；
先完成有界分页和重复 ID 去重，再按最多 100 个 ID 调用批量
`DELETE /api/public/traces`。`200`、`204` 和 `404` 都是幂等删除成功。HTTP timeout 为 15 秒，
请求/响应正文上限为 1 MiB。

`PersonalMemoryCommandWorkflow` 在 Hindsight old-generation bank 删除后执行：

1. generation fence 等待旧 lease 排空，Hindsight 删除已退役 bank；
2. 等待 10 分钟，使既有 exporter 的最长重试窗口结束；
3. `PurgePersonalMemoryTracesActivity` 清理两类 trace；
4. `VerifyPersonalMemoryTracesActivity` 查询 remaining count，非零时每分钟重复 purge/verify，
   最多五轮；
5. 两类 trace 均为零后执行 receipt finalization 和 app-api callback；五轮仍非零则返回固定
   `personal_memory_trace_erase_incomplete` 错误并保持未完成状态。

Langfuse 删除是异步的且没有 completion callback。DELETE 成功或删除数量不是产品 `erased` 的
充分条件。活动错误只返回固定 application error code；不得把 endpoint、credential、derived
userId、trace ID 或 response body 序列化到 Temporal Failure。

## 可用性

- 普通 trace export 是可选观测能力；Langfuse 不可用或配额停收不得阻塞在线回答。
- eval command 读取或写入失败必须使该离线命令失败。
- personal-memory erase maintenance 属于隐私生命周期；失败必须由 Temporal 有界重试且不能提前
  写完成状态。
- project、credential、Collector pipeline 或 workflow 存在不证明数据已写入或删除；需要数据事实时
  必须查询实际 project。

## 参考

- Langfuse OpenTelemetry：<https://langfuse.com/docs/integrations/native/opentelemetry>
- Langfuse 数据删除：<https://langfuse.com/docs/data-deletion>
