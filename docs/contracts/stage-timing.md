---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---
# 请求阶段耗时合同

## 边界

`stage_timing.v1` 是在线回答请求的仓库自有有界耗时投影。它规定哪些每请求 timing 字段可以
进入 app-api observability fact、字段由哪个 runtime 产生，以及诊断、metric 与 learning loop
如何消费。

它不是 OpenAI Agents SDK trace、Langfuse OTLP payload、Sentry/Axiom/Collector schema 或
Temporal history。告警阈值由 `configs/runtime/latency-budgets.v1.json` 与
`configs/runtime/observability-alerts.v1.json` 拥有，不在本文复制。

## 结构

`stage_timing.v1` 是 JSON object；key 必须来自下表，value 是毫秒：

```json
{
  "request.total_ms": 1840,
  "stream.browser_ttft_ms": 920,
  "agent.primary_ms": 1380,
  "agent.first_delta_ms": 710,
  "knowledge.search_ms": 360
}
```

规则：

- value 必须是有限、非负 number；
- 缺少字段表示阶段未运行或 producer 无法测量，不得用 `0` 占位；
- consumer 不得根据其他阶段推断未上报字段；
- timestamp、boolean、string、array 与 nested object 不是有效 timing value；
- payload 不得包含原始 prompt、answer、transcript、trace body、provider response、tool I/O、
  retrieval/memory 内容、auth material、secret、local path、object key 或 Temporal history。

## 字段

| 字段 | Producer | 含义 |
| --- | --- | --- |
| `request.total_ms` | `apps/app-api` | 从 app-api 接受请求到终态投影对 app-api 可见。 |
| `stream.browser_ttft_ms` | `apps/app-api` | 从接受浏览器请求到向 stream 发出第一个真实 answer delta。 |
| `execution.admission_ms` | `apps/execution-control` | run 进入执行路径前的准入耗时。 |
| `memory.recall_ms` | `apps/execution-control` | personal memory recall 与有界 context projection。 |
| `agent.primary_ms` | `apps/execution-control` | 单个 Agent Activity 的端到端耗时，包括 handoff 与 SDK tool。 |
| `agent.runtime_ms` | `apps/agent-runtime` | 完整 OpenAI Agents SDK run 耗时。 |
| `agent.first_delta_ms` | `apps/agent-runtime` | agent-runtime 接受请求到第一个可见 answer delta。 |
| `tool.total_ms` | `apps/execution-control` | 本次 run 中所有已投影 SDK tool call 的总耗时。 |
| `tool.transport_schedule_lookup_ms` | `apps/execution-control` | 选中 `transport_schedule_lookup` 时该分支的耗时。 |
| `knowledge.search_ms` | `apps/execution-control` | Agent Activity 内部 `knowledge_search` 调用耗时之和。 |
| `finalization.write_ms` | `apps/execution-control` | 写入有界 finalization projection 的耗时。 |
| `projection.closeout_ms` | `apps/app-api` | 接收 execution finalization 到完成 app-api observability fact。 |

不得增加 vendor-specific 字段。只在 Langfuse、SDK trace、Sentry、Axiom 或 Temporal UI 有意义
的细节留在对应系统，产品投影只保留 correlation identity。

`provider_queue_ms` 不是必需字段。provider 内部 queue 只有形成明确、稳定且安全的合同后才能
加入；当前通过 `agent.first_delta_ms`、`agent.runtime_ms`、`stream.browser_ttft_ms` 与 trace
correlation 排查启动延迟。

每个 canonical field 都必须被 `configs/runtime/latency-budgets.v1.json` 接受。单次请求可以
缺少未运行阶段，但 versioned budget artifact 必须覆盖整张字段表。`pnpm contracts:check`
负责校验字段、budget 与 alert materialization。

## 生产方

app-api 只产生：

- `request.total_ms`；
- `stream.browser_ttft_ms`；
- `projection.closeout_ms`。

execution-control 只产生：

- `execution.admission_ms`；
- `memory.recall_ms`；
- `agent.primary_ms`；
- 表中 `tool.*_ms` 与 `knowledge.search_ms`；
- `finalization.write_ms`。

agent-runtime 只产生 `agent.runtime_ms` 与 `agent.first_delta_ms`。

跨 service 聚合只能发生在 execution-control 或 app-api 的有界投影边界。producer 不得读取
raw Temporal history 或复制 downstream trace payload 来补 timing 字段。

## 消费方

- app-api 将有效 `stage_timing.v1` 写入 request observability fact；
- Ops Web 与其他受控诊断面可以显示分组耗时和 correlation link，不渲染 raw trace tree；
- learning loop 可以按 canonical field 选择 latency outlier，不复制 prompt、answer 或 provider
  payload；
- metric/OTel adapter 可以按 canonical stage name 生成低基数 histogram；request id、user id、
  raw URL/error 与任意 tool name 不得成为 metric label；
- app-api 的 `request.stage_timing` event 每个数字字段只发送 `stage_field`、`duration_ms`、
  budget state 与已允许 correlation 字段。

未知 timing key 不得展示或静默接受。非 canonical 的 app-api-owned timing 字段必须失败关闭。

`configs/runtime/observability-alerts.v1.json` 只定义 symptom alert policy，并由 contract tooling
转换为外部 monitor spec；它不创建 dashboard，也不镜像外部观测正文。

## 与 Trace 的关系

`stage_timing.v1` 回答“哪个仓库自有阶段慢”，trace correlation 用于获准运维人员继续查看当前
配置的观测系统。产品数据库只保存 correlation id 与有界 timing，不保存 sink URL、trace body
或 delivery proof。

OpenAI Agents SDK trace、Langfuse、Sentry 与 Axiom 可以提供进一步诊断，但不能替代本合同，
也不能把 SDK span、provider payload、tool I/O、prompt、answer 或 memory text 写入
`stage_timing.v1`。

## 相关文档

- `docs/data/app-api/runtime.md`
- `docs/contracts/langfuse-runtime.md`
- `docs/architecture/system/ops-observability.md`
- `docs/architecture/system/learning-loop.md`
- `docs/reference/telemetry.md`
