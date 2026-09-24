---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---
# 请求阶段耗时合同

## 边界

`stage_timing.v1` 是在线回答请求的有界耗时投影。它规定哪些每请求耗时字段可以进入 app-api
观测摘要、字段由哪个运行时产生，以及产品诊断与学习闭环如何消费。

它不是 OpenAI Agents SDK trace、Langfuse OTLP payload 或 Collector schema，也不是
Temporal history。单请求耗时预算由 `configs/runtime/latency-budgets.v1.json` 拥有；环境告警的
查询、阈值和投递由环境仓及所属观测平台拥有，不属于跨运行时合同。

## 结构

`stage_timing.v1` 是 JSON object；key 必须来自下表，value 是毫秒数：

```json
{
  "request.total_ms": 1840,
  "execution.dispatch_ms": 45,
  "workflow.schedule_to_start_ms": 80,
  "stream.first_delta_persist_ms": 940,
  "stream.app_api_ttft_ms": 1020,
  "stream.orchestration_overhead_ms": 310,
  "workflow.solve_ms": 210,
  "workflow.execute_step_ms": 580,
  "workflow.synthesize_ms": 420,
  "workflow.first_delta_ms": 210
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
| `workflow.schedule_to_start_ms` | `apps/execution-control` | 本次 Workflow 中 Solve、Executor、Replanner 和 Synthesizer Activity 从 Temporal 调度到 worker 开始执行的累计耗时。 |
| `stream.first_delta_persist_ms` | `apps/execution-control` | run 从 running 到首条 answer delta 与 streaming 状态原子提交的耗时。 |
| `stream.app_api_ttft_ms` | `apps/app-api` | 从 app-api 接受新请求到实际收到首条 answer delta 的耗时。 |
| `stream.orchestration_overhead_ms` | `apps/app-api` | `stream.app_api_ttft_ms - workflow.first_delta_ms`；仅在两者都存在且差值非负时写入。 |
| `execution.admission_ms` | `apps/execution-control` | run 进入执行路径前的准入耗时。 |
| `memory.recall_ms` | `apps/execution-control` | 已执行 personal memory recall 工具调用的耗时。 |
| `workflow.solve_ms` | `apps/agent-runtime` | Solve 模型 operation 的累计耗时；该 operation 可以直接回答，也可以返回任务计划。 |
| `workflow.execute_step_ms` | `apps/agent-runtime` | Executor 模型 operation 的累计耗时，包括本地工具和 hosted Web Search 调用。 |
| `workflow.replan_ms` | `apps/agent-runtime` | Replanner 模型 operation 的累计耗时。 |
| `workflow.synthesize_ms` | `apps/agent-runtime` | Synthesizer 模型 operation 的耗时。 |
| `workflow.first_delta_ms` | `apps/agent-runtime` | Synthesizer operation 开始到第一个可见 answer delta 的耗时。 |
| `tool.total_ms` | `apps/execution-control` | 本次 run 中所有已投影 SDK tool call 的总耗时。 |
| `finalization.write_ms` | `apps/execution-control` | 写入有界 finalization projection 的耗时。 |
| `projection.closeout_ms` | `apps/app-api` | 接收 execution finalization 到完成 app-api observability fact。 |

不得增加供应商专用字段。只在 Langfuse、SDK trace 或 Temporal UI 有意义的
细节留在对应系统，产品投影只保留关联标识。

`provider_queue_ms` 不是必需字段。provider 内部 queue 只有形成明确、稳定且安全的合同后才能
加入；当前通过 `workflow.first_delta_ms`、各 `workflow.*_ms`、`stream.app_api_ttft_ms`、
`stream.orchestration_overhead_ms` 与 trace correlation 排查启动延迟。

每个字段都必须被 `configs/runtime/latency-budgets.v1.json` 接受。单次请求可以缺少未运行阶段，
但版本化预算配置必须覆盖整张字段表。`pnpm --dir packages/contracts contracts:check` 负责校验字段与预算配置。

跨服务聚合只能发生在 execution-control 或 app-api 的有界投影边界。生产者不得读取原始
Temporal history 或复制下游 trace 响应来补耗时字段。

## 消费方

- app-api 将有效 `stage_timing.v1` 写入 request observability fact；
- Ops Web 与其他受控诊断面可以显示分组耗时和关联入口，不渲染原始 trace tree；
- 评测和诊断可以按固定字段定位耗时异常，不复制 prompt、答案或供应商响应；
- `runtime.request_observability_fact` 是 app-api 阶段耗时的最终可查询投影，允许通过独立的首次 TTFT
  写入与终态合并得到完整字段。

未知耗时 key 不得展示或静默接受。未登记的 app-api 耗时字段必须拒绝。

## 与 Trace 的关系

`stage_timing.v1` 回答“哪个仓库自有阶段慢”，trace correlation 用于获准运维人员继续查看当前
配置的观测系统。产品数据库只保存 correlation id 与有界 timing，不保存 sink URL、trace body
或投递记录。

OpenAI Agents SDK trace、Langfuse 与 Temporal UI 可以提供进一步诊断，但不能替代本合同，
也不能把 SDK span、provider payload、tool I/O、prompt、answer 或 memory text 写入
`stage_timing.v1`。

当前在线执行没有 Campus Docs 检索阶段，因此不产生检索阶段耗时。Campus Docs 的离线制品构建耗时
属于对应 Job 的运行记录，不进入 `stage_timing.v1`。

## 相关文档

- [App API 运行时数据](../data/app-api/runtime.md)
- [Langfuse 运行合同](./langfuse-runtime.md)
- [学习闭环](../architecture/system/learning-loop.md)
- [运行时遥测](../reference/telemetry.md)
