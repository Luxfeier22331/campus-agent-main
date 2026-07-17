---
doc_type: contract
owner_boundary: runtime-observability
status: active
---

# Langfuse 运行合同

## 边界

Langfuse 消费受信任 OpenTelemetry trace 和评测 score，不拥有产品 HTTP、Temporal 生命周期、
PostgreSQL run projection、Hindsight bank 或仓库 dataset 真相。

部署必须提供两个相互隔离的 project：runtime project 与 Hindsight project。它们使用不同
OTLP endpoint/auth、API key 和维护权限；任何环境不得把二者配置为同一项目。

## Runtime 集成

execution-control 使用 Go OTel SDK，并把 trace/metric 发送到 Collector orchestration receiver
`4319`。Collector 只把名称匹配 `execution_control.*` 的有界 trace 属性发送到 runtime project。

agent-runtime 使用：

- OpenAI Agents SDK 与 OpenInference instrumentation；
- 官方 `@langfuse/otel` span processor；
- 标准 Node OpenTelemetry tracer provider 和 OTLP exporter；
- Collector trusted receiver `4320` 与独立 bearer token。

Hindsight 使用原生 OTel trace、Collector trusted receiver `4321` 和 Hindsight project。其 LLM
trace 开关保持关闭，避免与通用 OTel trace 重复。execution-control 的 Hindsight HTTP transport
建立 `memory.call` 父 span，并把它从 `4319` 路由到同一 Hindsight project。

所有服务传递 W3C `traceparent` 与 `baggage`。产品请求不得携带 exporter endpoint、认证值、
采样率、project 或观测模式。producer 在进程关闭时 flush，不在每个 span 或请求后强制 flush。

## Collector 路由

| 输入 | 允许的 Langfuse 内容 | Project |
| --- | --- | --- |
| `4319` orchestration | `execution_control.*` 受控 trace | runtime |
| `4319` orchestration | 固定 `memory.call` 父 span | Hindsight |
| `4320` Agent trusted | Agent SDK、model、tool trace | runtime |
| `4321` Hindsight trusted | Hindsight 原生 trace | Hindsight |

受信任 `4320`/`4321` trace 不得进入 Axiom。Collector 不向 Sentry 导出，Langfuse trace 也不得
复制到 OpenObserve。每个 receiver 使用不同 bearer token；缺少 token、使用其他 receiver token
或 NetworkPolicy 不匹配时必须拒绝。

## Trace 数据

启用后，官方 Agent instrumentation 可以记录模型输入输出。W3C trace ID 是产品投影和评测任务
使用的关联键，但关联字段不证明 Langfuse 已成功接收。

runtime project 的受信任 trace 可以包含：

- user/session 关联；
- model input/output；
- 有界 memory context；
- 已授权 retrieval facts；
- tool/agent observation 和 usage。

Hindsight project 可以包含 Hindsight 处理所需的受信任记忆 trace，但 `memory.call` 父 span 只
允许 `memory.provider` 与 `http.request.method`。不得将 URL、bank/document/operation ID 或正文
添加到该父 span。

两个 project 都不得包含 Authorization、Cookie、API key、密码、数据库凭据、对象存储 secret
或其他认证材料。Collector 至少按 credential 名称模式删除属性；producer 仍必须在源头避免发送。

app-api、Ops Web、Axiom 和 Sentry 不复制 trace 正文；它们只保存关联标识、model/provider
identity、prompt version 摘要和 stage timing。`tool_trajectory.v2` 与
`agent_runtime_eval_projection.v2` 仍由仓库合同拥有。

## Hindsight 用户关联

Hindsight span 中的 bank 标识已经由 execution-control 使用稳定 owner salt、tenant、user 与
generation 派生。Collector 必须：

1. 将 `hindsight.bank_id`、`bank_id` 或同名 resource attribute 映射为
   `langfuse.user.id`；
2. 保留该派生值，不再次哈希或加盐；
3. 设置固定 Hindsight project tag/environment；
4. 删除原 bank 属性。

runtime project 可以按受控 trace 合同保存产品 `UserID`；Hindsight project 不保存该原始值。
owner erase 对 runtime project 使用 command 冻结的产品 `UserID`，并以同一 command 的
`source_updated_at` 作为删除与复核上界；这样不会删除 erase 命令之后产生的新 runtime trace。
Hindsight project 使用完全相同的派生函数计算已退役 generation 的 `userId`，并精确清空该 bank
的全部 trace。owner salt 不进入任一 Langfuse project。

## Owner erase maintenance

execution-control core worker 通过以下配置访问两个 project 的 Public API：

- `LANGFUSE_MAINTENANCE_BASE_URL`
- `LANGFUSE_RUNTIME_MAINTENANCE_PUBLIC_KEY`
- `LANGFUSE_RUNTIME_MAINTENANCE_SECRET_KEY`
- `LANGFUSE_HINDSIGHT_MAINTENANCE_PUBLIC_KEY`
- `LANGFUSE_HINDSIGHT_MAINTENANCE_SECRET_KEY`

部署的 `activity-core` 必须同时配置五项；任何一项缺失都是启动配置错误。runtime 与 Hindsight
key 必须属于各自 project，base URL 必须是没有内嵌 credential 的 HTTP(S) origin。

maintenance client 使用 HTTP Basic auth。owner erase 对 runtime project 执行精确
`GET /api/public/traces?userId=<command.UserID>&toTimestamp=<command.source_updated_at>`，对
Hindsight project 执行精确 `GET /api/public/traces?userId=<retired-generation-bank-id>`。
runtime 查询故意覆盖该 user 在 command 上界内的全部 trace，因为任一 Agent trace 都可能包含
memory context；不得按 conversation、request、tag 或 observation 名称缩窄删除范围，也不得
省略时间上界而删除命令之后的新 trace。Hindsight 查询不加时间上界，因为 generation fence 已
阻止已退役 bank 接收新调用，验收目标是该 bank 全部清空。
purge 使用 `fields=core`、`orderBy=timestamp.asc`，每页最多取 100 个 trace ID，最多读取 1000 页；
先完成有界分页和重复 ID 去重，再按最多 100 个 ID 调用批量
`DELETE /api/public/traces`。`200`、`204` 和 `404` 都是幂等删除成功。HTTP timeout 为 15 秒，
请求/响应正文上限为 1 MiB。

Temporal `PersonalMemoryCommandWorkflow` 在 Hindsight old-generation bank 删除后执行：

1. `PurgePersonalMemoryTracesActivity` 依次清理 runtime project 中不晚于
   `command.source_updated_at` 的该用户 trace，以及 Hindsight project 中已退役 bank 的全部 trace；
2. 15 分钟 timer；
3. purge 后执行 `VerifyPersonalMemoryTracesActivity`，runtime 上界内或 Hindsight 已退役 bank 的
   remaining count 非零时每分钟重复；
4. 第一检查点收敛后再等待 23 小时 45 分钟，使第二检查点不早于首次 purge 后 24 小时；
5. purge/verify 到零；
6. 才执行 receipt finalization 和 app-api callback。

Langfuse 删除是异步的且没有 completion callback。DELETE 成功、两个项目合计的
`deleted_trace_count` 或第一个零结果都不是产品 `erased` 的充分条件。只有两个检查点都确认
runtime project 在冻结上界内的目标 trace 为零，且 Hindsight 已退役 bank 的全部 trace 为零，
才能完成；上界之后的新 runtime trace 不计入 remaining count，也不得被删除。活动错误只返回按
runtime/Hindsight 区分的固定 application error code；不得把
endpoint、credential、derived userId、trace ID 或 response body 序列化到 Temporal Failure。

## 七天 retention maintenance

workflow worker 启动时收敛以下 Temporal Schedule。首次启动执行 Create；`AlreadyExists` 后必须
通过 Schedule Update 重写固定 spec、action 和 policy，同时保留现有 paused/note 等 State。
Create、Describe/GetHandle 或 Update 失败都会阻止该 worker 启动，不能静默接受漂移：

| 字段 | 固定值 |
| --- | --- |
| Schedule ID | `campus-agent.langfuse.trace-retention.daily.v1` |
| Cron / timezone | `0 3 * * *` / `UTC` |
| Workflow ID | `campus-agent.langfuse.trace-retention.daily` |
| Workflow type | `LangfuseTraceRetentionWorkflow` |
| Overlap | `SKIP` |
| Catchup window | 24 小时 |
| Workflow run timeout | 6 小时 |
| Pause on failure | `false` |

workflow 用 replay-safe `workflow.Now(ctx).UTC()` 减七天得到单一 cutoff，并在整个 run 中保持不变。
每轮依次执行：

1. `PurgeLangfuseTraceRetentionActivity` 对 runtime 与 Hindsight project 使用
   `toTimestamp=<cutoff>` 删除；
2. Temporal timer 等待 15 分钟；
3. `VerifyLangfuseTraceRetentionActivity` 用相同 cutoff 查询两个 project 的 `totalItems`；
4. 任一项目非零时进入下一轮，最多三轮。

两个项目均为零时 workflow 返回 cutoff、累计删除数和 verification round。三轮后仍非零时返回
non-retryable `langfuse_trace_retention_incomplete`；Schedule 保持 active，下一次日常运行继续尝试。

两个 Activity 固定运行在 core task queue，`StartToCloseTimeout=30m`、`HeartbeatTimeout=30s`，
最多重试三次，退避从 10 秒到一分钟。cutoff 无效和 maintenance 未配置不重试。所有其他 API
错误使用按项目区分的固定错误码，并保持正文脱敏。

## 数据集运行

评测通过真实产品路径执行。每个目标 turn：

1. 可选 setup turn 在同一 conversation 中依次执行；
2. runner 读取完成 run 的 `agent_runtime_eval_projection.v2`；
3. 从 product trace identity 解析 runtime Langfuse trace；
4. 调用 `/api/public/dataset-run-items` 关联真实 trace；
5. 保留 Langfuse 返回的 dataset run identity；
6. 调用 Ragas runner 并发布已登记 score。

因为产品请求已经生成 canonical trace，runner 不使用 `runExperiment` 创建第二条 trace。

## 评分

`packages/eval-langfuse` 通过 `POST /api/public/scores` 同步发布。每个 payload 只能指向一个
observation，若无 observation 则指向一个 trace。dataset item/run ID 不属于 score target。

允许的 score family：

- Ragas RAG 指标；
- Ragas Agent 与工具指标；
- `execution.outcome_match`；
- `retrieval.forbidden_context_absent`。

未知名称、缺失关联、非有限数值或 Langfuse 写入失败必须使发布命令失败。metadata 只允许标量
白名单，答案和 context text 不进入 score metadata。

## 可用性

- 普通 trace export 是观测能力；Langfuse 不可用不得阻塞在线回答。
- eval command 读取或写入失败必须使该离线命令失败。
- owner erase/retention maintenance 属于隐私生命周期；失败必须由 Temporal 重试且不能提前写
  完成状态。
- project、credential、Collector pipeline 或 workflow 存在不证明数据已写入或删除；必须通过
  实际 project 查询验证。

## 参考

- Langfuse OpenTelemetry：<https://langfuse.com/docs/integrations/native/opentelemetry>
- Langfuse 数据删除：<https://langfuse.com/docs/data-deletion>
- Langfuse 数据保留：<https://langfuse.com/docs/administration/data-retention>
