---
doc_type: contract
owner_boundary: runtime-observability
status: active
---

# Langfuse 运行合同

## 边界

Langfuse 消费 OpenTelemetry trace 和评测 score，不拥有产品 HTTP、Temporal 生命周期、
PostgreSQL run projection 或仓库 dataset 真相。

## Runtime 集成

execution-control 通过标准 OTLP HTTP exporter 发送 Go OTel span。agent-runtime 使用：

- OpenAI Agents SDK 与 OpenInference 埋点；
- 官方 `@langfuse/otel` span 处理器；
- 标准 Node OpenTelemetry tracer provider 和 OTLP 导出器。

服务传递 W3C `traceparent` 和 `baggage`。exporter 目标与 header 由标准
`OTEL_EXPORTER_OTLP_*` 配置提供，`OTEL_SERVICE_NAME` 标识服务。产品请求不得携带 endpoint、
认证值、采样率或观测模式。

instrumentation 只在进程配置了 exporter 时启用；未配置时 agent 继续运行。provider 在进程关闭
时 flush，不在每个 span 或请求后强制 flush。

## Trace 数据

启用后，官方 instrumentation 可以记录 Agent SDK 模型输入输出。W3C trace ID 是产品投影和评测
任务使用的关联键，但关联字段不证明 Langfuse 已成功接收。

受信任 trace 可以包含：

- user/session 关联；
- model input/output；
- 有界记忆上下文；
- 已授权 retrieval facts；
- tool/agent observation 和 usage。

不得包含 Authorization、Cookie、API key、密码、数据库凭据、对象存储 secret 或其他认证材料。

app-api 和 Ops Web 不复制 trace 正文；它们只保存关联标识、model/provider
identity、prompt version 摘要和 stage timing。`tool_trajectory.v2` 与
`agent_runtime_eval_projection.v2` 仍由仓库合同拥有。

## 数据集运行

评测通过真实产品路径执行。每个目标 turn：

1. 可选 setup turn 在同一 conversation 中依次执行；
2. runner 读取完成 run 的 `agent_runtime_eval_projection.v2`；
3. 从 product trace identity 解析 Langfuse trace；
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

trace export 和 eval command 属于观测/离线评测。Langfuse 不可用不得阻塞在线回答，Temporal 和
PostgreSQL 仍是执行生命周期真相。
