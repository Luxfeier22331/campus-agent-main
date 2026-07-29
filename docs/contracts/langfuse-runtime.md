---
doc_type: contract
owner_boundary: runtime-observability
status: active
---

# Langfuse 运行合同

## 边界

Langfuse 消费受信任 OpenTelemetry trace 和评测 score，不拥有产品 HTTP、Temporal 生命周期、
PostgreSQL run projection、Hindsight bank 或仓库 dataset 真相。

所有环境使用 Langfuse Cloud Japan 区域中的 `campus-agent` project，并通过原生 `environment`
字段区分 local、staging 和 production。Agent、execution-control 与 Hindsight trace 通过
`service.name`、固定 tag、receiver 和字段合同区分，不创建第二个 project 模拟环境或服务边界。

## Runtime 集成

execution-control 使用 Go OTel SDK，并把 trace/metric 发送到 Collector orchestration receiver
`4319`。Temporal workflow、core activity 和 agent activity worker 均使用该入口。Collector 只把
名称匹配 `execution_control.*` 的有界 trace 属性发送到环境 project。

`grounding.prepare` 是 execution-control 的编排 span，不是 SDK tool 或 model generation。它可以
包含 grounding mode/status、受控 scope、候选/证据/token/context 计数和 embedding/search/RRF/pack
阶段耗时；这些字段只描述检索准备摘要，不包含 query、正文、证据内容或 provider 原始响应。
历史 `grounding.rerank_ms` 字段仅作为零值兼容观测，不表示外部 reranker。

agent-runtime 使用：

- OpenAI Agents SDK 与 OpenInference instrumentation；
- 官方 `@langfuse/otel` span processor；
- 标准 Node OpenTelemetry tracer provider 和 OTLP exporter；
- Collector trusted receiver `4320`。

Hindsight 使用原生 OTel trace、Collector trusted receiver `4321` 和同一环境 project。其 LLM
trace 开关保持关闭，避免与通用 OTel trace 重复。execution-control 的 Hindsight HTTP transport
建立 `memory.call` 父 span，并把它从 `4319` 路由到同一 project。

所有服务传递 W3C `traceparent` 与 `baggage`。产品请求不得携带 exporter endpoint、认证值、
采样率、project 或观测模式。producer 在进程关闭时 flush，不在每个 span 或请求后强制 flush。

## Collector 路由

| 输入 | 允许的 Langfuse 内容 | 区分方式 |
| --- | --- | --- |
| `4319` orchestration | `execution_control.*` 受控 trace | execution-control service/tag |
| `4319` orchestration | 固定 `memory.call` 父 span | memory tag |
| `4320` Agent trusted | Agent SDK、model、tool trace | agent-runtime service/tag |
| `4321` Hindsight trusted | Hindsight 原生 trace | hindsight service/tag |

受信任 `4320`/`4321` trace 不得进入 Axiom。Collector 不向 Sentry 导出，Langfuse trace 也不得
复制到 OpenObserve。四个 receiver 不执行集群内应用认证；生产者准入由 namespace 内精确
NetworkPolicy、Pod selector 和目标端口共同约束，NetworkPolicy 不匹配时必须拒绝。

## Trace 数据

Agent producer 必须保持 `traceIncludeSensitiveData=false`。W3C trace ID 是产品投影和评测任务
使用的关联键，但关联字段不证明 Langfuse 已成功接收。

Agent 与 execution-control 的受信任 trace 可以包含不同范围的数据：

- Agent Runtime：user/session 关联、model/provider 标识、token usage、agent/tool observation 和阶段结果；
- execution-control：编排关联标识、步骤状态、耗时、grounding 摘要和有界 metadata；
- execution-control 不声明 model、token 或 generation 语义，避免复制 Agent Runtime 的 generation。

同一 project 可以包含 Hindsight 处理所需的受信任记忆 trace，但 `memory.call` 父 span 只
允许 `memory.provider` 与 `http.request.method`。不得将 URL、bank/document/operation ID 或正文
添加到该父 span。

任何运行 trace 都不得包含 prompt、模型输入输出、对话、工具原始载荷、memory/retrieval 正文、
provider 原始响应、Authorization、Cookie、API key、密码、数据库凭据、对象存储 secret 或其他
认证材料。Collector 的属性清理只是纵深防御，producer 必须在源头阻止正文进入 span。

app-api、Ops Web、Axiom 和 Sentry 也只保存关联标识、model/provider identity、prompt version
摘要和 stage timing。`tool_trajectory.v3` 与
`agent_runtime_eval_projection.v3` 仍由仓库合同拥有。

Langfuse dataset 是独立评测数据生命周期。经评审导入的版本化 case 可以按评测合同包含必要
输入和 reference；不得从生产 trace 正文隐式生成 dataset item，也不得借 dataset API 绕过运行
trace 的正文禁令。

## Hindsight 用户关联

Hindsight span 中的 bank 标识已经由 execution-control 使用稳定 owner salt、tenant、user 与
generation 派生。Collector 必须：

1. 将 `hindsight.bank_id`、`bank_id` 或同名 resource attribute 映射为
   `langfuse.user.id`；
2. 保留该派生值，不再次哈希或加盐；
3. 设置固定 Hindsight tag/environment；
4. 删除原 bank 属性。

Agent/runtime trace 可以按受控合同保存产品 `UserID`；Hindsight trace 不保存该原始值。
owner erase 对 Agent/runtime trace 使用 command 冻结的产品 `UserID`，并以同一 command 的
`source_updated_at` 作为删除与复核上界；这样不会删除 erase 命令之后产生的新 runtime trace。
Hindsight trace 使用完全相同的派生函数计算已退役 generation 的 `userId`，并精确清空该 bank
的全部 trace。owner salt 不进入 Langfuse。

## Owner erase maintenance

execution-control core worker 通过以下配置访问环境 project 的 Public API：

- `LANGFUSE_MAINTENANCE_BASE_URL`
- `LANGFUSE_MAINTENANCE_PUBLIC_KEY`
- `LANGFUSE_MAINTENANCE_SECRET_KEY`

部署的 `activity-core` 必须同时配置三项；任何一项缺失都是启动配置错误。key 必须属于
`campus-agent` project，base URL 必须是没有内嵌 credential 的 Langfuse Cloud HTTP(S) origin。

maintenance client 使用 HTTP Basic auth。owner erase 在同一 project 中先执行精确
`GET /api/public/traces?userId=<command.UserID>&toTimestamp=<command.source_updated_at>`，再执行
精确 `GET /api/public/traces?userId=<retired-generation-bank-id>`。
runtime 查询故意覆盖该 user 在 command 上界内的全部 trace，因为这些 trace 仍是用户关联数据；
不得按 conversation、request、tag 或 observation 名称缩窄删除范围，也不得
省略时间上界而删除命令之后的新 trace。Hindsight 查询不加时间上界，因为 generation fence 已
阻止已退役 bank 接收新调用，验收目标是该 bank 全部清空。
purge 使用 `fields=core`、`orderBy=timestamp.asc`，每页最多取 100 个 trace ID，最多读取 1000 页；
先完成有界分页和重复 ID 去重，再按最多 100 个 ID 调用批量
`DELETE /api/public/traces`。`200`、`204` 和 `404` 都是幂等删除成功。HTTP timeout 为 15 秒，
请求/响应正文上限为 1 MiB。

Temporal `PersonalMemoryCommandWorkflow` 在 Hindsight old-generation bank 删除后执行：

1. generation fence 等待旧 lease 排空，Hindsight 删除已退役 bank；
2. 等待 10 分钟，使最大重试窗口为 5 分钟的 Collector exporter 完成旧 trace 投递；
3. `PurgePersonalMemoryTracesActivity` 依次清理同一 project 中不晚于
   `command.source_updated_at` 的该用户 trace，以及已退役 bank 的全部 Hindsight trace；
4. purge 后执行 `VerifyPersonalMemoryTracesActivity`，remaining count 非零时每分钟重复
   purge/verify，最多五轮；
5. 两类 trace 均为零后执行 receipt finalization 和 app-api callback；五轮仍非零则返回固定
   `personal_memory_trace_erase_incomplete` 错误并保持未完成状态。

Langfuse 删除是异步的且没有 completion callback。DELETE 成功、两类查询合计的
`deleted_trace_count` 不是产品 `erased` 的充分条件。只有查询确认 Agent/runtime trace 在冻结
上界内为零，且 Hindsight 已退役 bank 的全部 trace 为零，才能完成；上界之后的新 runtime trace
不计入 remaining count，也不得被删除。活动错误只返回按
runtime/Hindsight 区分的固定 application error code；不得把
endpoint、credential、derived userId、trace ID 或 response body 序列化到 Temporal Failure。

## 数据集运行

评测通过真实产品路径执行。每个目标 turn：

1. 可选 setup turn 在同一 conversation 中依次执行；
2. runner 读取完成 run 的 `agent_runtime_eval_projection.v3`；
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
- `routing.grounding_mode_match`。

未知名称、缺失关联、非有限数值或 Langfuse 写入失败必须使发布命令失败。metadata 只允许标量
白名单，答案和 context text 不进入 score metadata。

## 可用性

- 普通 trace export 是观测能力；Langfuse 不可用不得阻塞在线回答。
- eval command 读取或写入失败必须使该离线命令失败。
- owner erase maintenance 属于隐私生命周期；失败必须由 Temporal 有界重试且不能提前写
  完成状态。
- project、credential、Collector pipeline 或 workflow 存在不证明数据已写入或删除；必须通过
  实际 project 查询验证。

## 参考

- Langfuse OpenTelemetry：<https://langfuse.com/docs/integrations/native/opentelemetry>
- Langfuse 数据删除：<https://langfuse.com/docs/data-deletion>
