---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---
# 持久执行合同

## 边界

本文定义在线执行链路对 app-api、诊断与评测开放的稳定投影。Temporal workflow history
是执行事实；PostgreSQL 中的 run、event、step、attempt 和 result 只是有界投影，不承担
queue、lease 或 workflow engine 职责。

私有 HTTP wire 以 `docs/contracts/schemas/tool-execution.openapi.yaml` 为准，逻辑数据模型见
`docs/data/durable-runtime.md`。

## 标识符

- `conversation_id`：app-api 拥有的产品会话；
- `turn_id`：一次用户轮次；
- `request_id`：关联 app-api 请求与执行；
- `run_id`：一次持久回答执行；
- `step_id`：run 内一个 workflow 阶段或投影出的内部操作；
- `attempt_id`：一次 Temporal activity attempt 投影；
- `trace_id`：关联已批准的观测系统，不负责生命周期事实。

run 创建后标识符不可变；嵌套 execution payload 的标识必须与 run envelope 一致。

## 生命周期

run 状态只能是 `created`、`queued`、`admitted`、`running`、`streaming`、
`completed`、`failed`、`canceled` 或 `expired`。

`completed`、`failed`、`canceled` 和 `expired` 是终态。终态不可再次迁移，迟到的 activity
成功也不能覆盖终态。每个终态 run 都必须包含低基数 `terminal_reason`。

`streaming` 只表示执行已产生可流式传输的输出，不表示浏览器连接仍然存在。

## 工作流

`ToolExecutionWorkflow` 按顺序调度四个阶段：

1. core activity queue 上的 Memory Recall；
1. agent activity queue 上的一次 Agent Activity；
1. core activity queue 上的 Finalization；
1. core activity queue 上的 Memory Append。

Agent Activity 承载一次完整的 OpenAI Agents SDK run。Primary Agent 决策、正式 handoff、
Knowledge Agent 执行和 SDK function-tool call 都留在该 activity 内。系统不存在独立 knowledge
worker、specialist queue、typed-tool activity、agent-as-tool activity、Go RAG graph 或持久
replan 阶段。

## Agent 与知识投影

Agent Activity 只能投影有界事实，例如：

- active/selected agent 与 tool 标识；
- SDK handoff 和 function-tool 摘要；
- 可公开的 provider/model 标识及 input/output/cached token 用量；
- terminal envelope 和 provider response ref；
- trace 关联与阶段耗时；
- `agent_runtime_prompt_trace.v1` 的 prompt id 与 hash。

`final_model_context.v2` 只向持久投影提供数量、字符数和截断诊断；
`truncation_summary.v2` 不保存被删除的内容。模型费用由 Langfuse 计算，不写入 PostgreSQL
attempt 字段。

`knowledge_query` 是模型可见的 handoff；Knowledge Agent 唯一的内部工具是
`knowledge_search`。execution-control 按 run 绑定的 target 与访问上下文准入每次搜索，只能
投影有界 result ref、outcome 和 source identity。

原始 prompt、SDK state、tool arguments、vector、Qdrant payload、provider response 和无限制
snippet 不属于持久投影。

## 终态处理

Finalization 校验 SDK terminal envelope 和 evidence closure，不调用模型，也不改写答案。
对于有证据支持的回答，execution-control 将每个终态 evidence ref 与可信
`knowledge_search` result 对照并生成顶层 `result.sources`；伪造、缺失或冲突的引用会使 run
失败。

最终响应可以包含：

- answer、status、follow-up 和 error；
- 已搜索的 `resolved_targets[]`；
- selected tool 及列表；
- 已确认的 session update；
- 顶层可信 source；
- workflow trace summary、stage timing 和 trace 关联；
- model/provider 标识与 `agent_runtime_prompt_trace.v1`。

app-api 可以把已验证 source 转换为浏览器 source card 或诊断摘要，但不得根据缺失数据推断
retrieval candidate、grounding verdict 或 quality score。

## Event、Step 与 Result

同一 run 内的 event 按单调递增 sequence 排序。step、attempt 和 result 投影记录阶段状态、
Temporal queue/worker 标识，以及 retry、cancel、timeout 和 fail-close 结果。

四个 workflow 阶段可以表示为 step。SDK 内部 handoff 与 function call 可以形成有界摘要或
子投影，但不得形成第二套持久执行图。消费者读取这些投影或基于它们形成的 read model，不回放
Temporal history 内部数据。

## 队列

正式 queue 与 WorkerDeployment 角色为：

- `workflow-worker` 轮询 workflow task queue；
- `activity-worker-core` 轮询 core activity task queue；
- `activity-worker-agent` 轮询 agent activity task queue。

PostgreSQL row 和进程内 queue 都不是调度事实。不得新增 knowledge、retrieval、tool 或
specialist task queue。

## 取消与重试

Temporal 负责 activity retry、timeout、heartbeat 与 cancellation 语义；execution-control
负责取消准入和终态投影。

- retry 增加 Temporal/activity attempt 投影；
- 显式取消以 `canceled` 结束 run；
- timeout 使用允许的 timeout reason 结束 run；
- 迟到完成记录为 ignored，不能重新打开 run；
- 面向用户的文本不能替代 terminal 或 fail-close code。

Agent runtime 终态错误在有界失败投影中保留
`context_budget_exceeded`、`agent_deadline_exceeded`、`max_turns_exceeded`、
`provider_unavailable`、`tool_execution_failed` 或 `run_failed`。

## 数据安全

持久投影不得包含：

- 原始 prompt、transcript 或 provider request/response；
- 原始 model/tool output payload；
- 原始 memory payload 或 vendor memory id；
- auth token、cookie、credential 或宽泛 identity snapshot；
- 原始 source body、vector record 或 object-store bytes；
- 本地文件路径。

## 验证

按 `docs/reference/verification.md` 执行合同与 Go 检查：

```bash
pnpm contracts:generate
pnpm ci:contracts
pnpm go:check
```
