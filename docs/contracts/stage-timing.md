---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---
# 请求阶段耗时合同

## 边界

`stage_timing.v1` 是在线回答请求的有界耗时投影。它规定哪些每请求耗时字段可以进入 app-api
观测摘要、字段由哪个运行时产生，以及诊断、指标与学习闭环如何消费。

它不是 OpenAI Agents SDK trace、Langfuse OTLP payload、Sentry/Axiom/Collector schema 或
Temporal history。单请求耗时预算由 `configs/runtime/latency-budgets.v1.json` 拥有；环境告警的
查询、阈值和投递由环境仓及所属观测平台拥有，不属于跨运行时合同。

## 结构

`stage_timing.v1` 是 JSON object；key 必须来自下表，value 是毫秒数：

```json
{
  "request.total_ms": 1840,
  "execution.dispatch_ms": 45,
  "agent.schedule_to_start_ms": 80,
  "stream.first_delta_persist_ms": 940,
  "stream.app_api_ttft_ms": 1020,
  "stream.orchestration_overhead_ms": 310,
  "grounding.prepare_ms": 360,
  "agent.primary_ms": 1380,
  "agent.first_delta_ms": 710
}
```

规则：

- value 必须是有限、非负数字；
- 缺少字段表示阶段未运行或生产者无法测量，不得用 `0` 占位；
- 消费方不得根据其他阶段推断未上报字段；
- timestamp、boolean、string、array 与 nested object 不是有效 timing value；
- payload 不得包含原始 prompt、answer、transcript、trace body、provider response、tool I/O、
  retrieval/memory 内容、auth material、secret、local path、object key 或 Temporal history。

## 字段

| 字段 | Producer | 含义 |
| --- | --- | --- |
| `request.total_ms` | `apps/app-api` | 从 app-api 接受请求到终态投影对 app-api 可见。 |
| `execution.dispatch_ms` | `apps/execution-control` | run 从创建到进入 queued 状态的耗时。 |
| `agent.schedule_to_start_ms` | `apps/execution-control` | `agent.primary` Activity 从 Temporal 调度到 worker 开始执行的耗时。 |
| `stream.first_delta_persist_ms` | `apps/execution-control` | run 从 running 到首条 answer delta 与 streaming 状态原子提交的耗时。 |
| `stream.app_api_ttft_ms` | `apps/app-api` | 从 app-api 接受新请求到实际收到首条 answer delta 的耗时。 |
| `stream.orchestration_overhead_ms` | `apps/app-api` | `stream.app_api_ttft_ms - agent.first_delta_ms`；仅在两者都存在且差值非负时写入。 |
| `execution.admission_ms` | `apps/execution-control` | run 进入执行路径前的准入耗时。 |
| `grounding.prepare_ms` | `apps/execution-control` | `grounding.prepare` 从开始到受保护 context 与有界投影写入完成的耗时。 |
| `memory.recall_ms` | `apps/execution-control` | 已执行 personal memory recall 工具调用的耗时。 |
| `agent.primary_ms` | `apps/execution-control` | 单个 Agent Activity 的端到端耗时，包括 SDK 工具调用。 |
| `agent.runtime_ms` | `apps/agent-runtime` | 完整 OpenAI Agents SDK run 耗时。 |
| `agent.first_delta_ms` | `apps/agent-runtime` | agent-runtime 接受请求到第一个可见 answer delta。 |
| `tool.total_ms` | `apps/execution-control` | 本次 run 中所有已投影 SDK tool call 的总耗时。 |
| `finalization.write_ms` | `apps/execution-control` | 写入有界 finalization projection 的耗时。 |
| `projection.closeout_ms` | `apps/app-api` | 接收 execution finalization 到完成 app-api observability fact。 |

不得增加供应商专用字段。只在 Langfuse、SDK trace、Sentry、Axiom 或 Temporal UI 有意义的
细节留在对应系统，产品投影只保留关联标识。

`provider_queue_ms` 不是必需字段。provider 内部 queue 只有形成明确、稳定且安全的合同后才能
加入；当前通过 `agent.first_delta_ms`、`agent.runtime_ms`、`stream.app_api_ttft_ms`、
`stream.orchestration_overhead_ms` 与 trace correlation 排查启动延迟。

浏览器从提交到渲染首段文本的真实 TTFT 由 Campus Web 直接写入 Sentry
`chat.browser_ttft_ms`，不进入服务端 `stage_timing.v1`。恢复已有 run 的订阅没有新请求起点，
不得记录浏览器 TTFT。

每个字段都必须被 `configs/runtime/latency-budgets.v1.json` 接受。单次请求可以缺少未运行阶段，
但版本化预算配置必须覆盖整张字段表。`pnpm contracts:check` 负责校验字段与预算配置。

跨服务聚合只能发生在 execution-control 或 app-api 的有界投影边界。生产者不得读取原始
Temporal history 或复制下游 trace 响应来补耗时字段。

## 消费方

- app-api 将有效 `stage_timing.v1` 写入 request observability fact；
- Ops Web 与其他受控诊断面可以显示分组耗时和关联入口，不渲染原始 trace tree；
- 学习闭环可以按固定字段选择耗时异常，不复制 prompt、答案或供应商响应；
- app-api 的 `request.finalized` event 使用相同的固定字段名发送有效耗时，并附带汇总 budget state
  与已允许 correlation 字段。

未知耗时 key 不得展示或静默接受。未登记的 app-api 耗时字段必须拒绝。

## 与 Trace 的关系

`stage_timing.v1` 回答“哪个仓库自有阶段慢”，trace correlation 用于获准运维人员继续查看当前
配置的观测系统。产品数据库只保存 correlation id 与有界 timing，不保存 sink URL、trace body
或投递记录。

OpenAI Agents SDK trace、Langfuse、Sentry 与 Axiom 可以提供进一步诊断，但不能替代本合同，
也不能把 SDK span、provider payload、tool I/O、prompt、answer 或 memory text 写入
`stage_timing.v1`。

`grounding.prepare_ms` 是产品可见的聚合耗时；embedding、search、RRF 合并与 pack 的明细只作为
受控 execution-control span 属性发送到 Langfuse/Axiom，不新增产品投影字段。现有
`grounding.rerank_ms` 键保留为零值兼容字段，不表示外部 reranker 调用。

## 相关文档

- `docs/data/app-api/runtime.md`
- `docs/contracts/langfuse-runtime.md`
- `docs/architecture/system/ops-observability.md`
- `docs/architecture/system/learning-loop.md`
- `docs/reference/telemetry.md`
