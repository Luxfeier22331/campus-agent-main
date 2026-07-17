---
doc_type: architecture
owner_boundary: runtime-observability
status: active
---

# Langfuse

## 边界

Langfuse 是 LLM 可观测和评测平台，保存 trace、dataset、experiment run、score 和 annotation
工作流。它不拥有在线执行、产品数据库、Temporal history、仓库合同或发布决定。

## Trace 链路

```text
app-api W3C context
-> execution-control Go OTel
-> agent-runtime OpenAI Agents SDK instrumentation
-> OTLP exporter
-> Collector / Langfuse OTLP endpoint
-> Langfuse trace
```

agent-runtime 使用 OpenAI Agents SDK instrumentation、`@langfuse/otel` span processor 和标准
OTLP exporter。execution-control 使用 Go OTel SDK。两者传递 `traceparent` 和 `baggage`；
endpoint、header 和 service name 来自部署配置。

Langfuse 不可用不得阻塞在线回答。Temporal 和 PostgreSQL 受控投影仍是执行生命周期与产品诊断
真相。

## 评测链路

```text
repo cases.v1.json
-> 真实 app-api / Temporal / Agent SDK 请求
-> eval projection + product trace
-> Langfuse dataset-run-item 关联
-> eval-langfuse 安全适配
-> ragas-runner 官方指标
-> Langfuse registered scores
```

`packages/eval-langfuse` 负责平台 API、真实产品 dataset run、dataset/score config sync、安全
投影、trace 关联、score 发布和 trace 验证。`packages/ragas-runner` 只调用 Ragas 官方
`ascore()`，不拥有 dataset、编排或发布 gate。

## 观测所有权

- `tool_trajectory.v2` 拥有 public/internal tool call 事实；
- `agent_runtime_eval_projection.v2` 拥有答案、检索上下文、文档 ID 和 resolved target；
- `cases.v1.json` 拥有 reference、预期 target、outcome、搜索次数和 context ID；
- Langfuse 通过 trace/dataset identity 关联这些事实，但不能重新定义 schema。

每个 dataset item 通过官方 API 关联真实 product trace，不使用 `runExperiment` 创建第二条
合成执行 trace。score 同步写入一个 observation 或 trace；dataset identity 只作为 lineage。

模型成本由 Langfuse 根据 model identity 和 token usage 计算，运行投影不维护平行成本估算。

## 数据边界

self-hosted Langfuse 是受信任内部观测面。采样 trace 可以包含用户/session 关联、模型输入输出、
memory context 和已授权检索事实；Authorization、Cookie、API key、密码、数据库凭据和对象存储
secret 始终禁止。

app-api 和 Ops Web 只保存关联标识与有界摘要，不复制 Langfuse trace 正文。
score metadata 只允许标量白名单字段，答案和 context text 留在 trace、dataset 和 Ragas sample。

## 相关文档

- `../../contracts/langfuse-runtime.md`
- `../../reference/eval.md`
- `../../runbooks/ragas.md`
- `../../decisions/adr-0062-ragas-langfuse.md`
- `../../decisions/adr-0076-langfuse-trace-data.md`
