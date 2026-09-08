# agent-runtime

执行校园信息 workflow 中模型 operation 的 TypeScript 服务。

## 职责

- 执行 Solve、Executor、Replanner 和 Synthesizer；Solve 可以直接回答，也可以返回任务计划；
- 严格解析并做结构 schema 校验 Solve/Replanner 返回的 JSON 文本，以及步骤摘要和最终文本；结构化合同不依赖
  OpenAI-compatible Provider 强制执行 JSON Schema；
- 只向 Executor 开放当前步骤声明且本轮获准的函数工具，以及可用时的托管 `web_search`；
- 消费 execution-control 提供的预期 Model Target hash、上下文和 operation 预算，并从共同受信任的
  Model Config 读取仍匹配该 hash 的 `primary_agent` 配置；该名称是历史配置键，不是 Agent 层级；
- 把本地函数调用交回 execution-control，不直接访问产品数据库、Campus Docs 数据库或 Hindsight；
- 返回 operation 结果、证据、source attempts、模型用量和调用链关联信息；
- 通过 OpenTelemetry 与 Langfuse 记录受控模型轨迹。

持久执行、计划顺序、重新规划次数、取消、工具准入和产品终态属于 execution-control 与 Temporal。
本应用不保存会话或运行状态。

Solve 的 SDK 输出使用根对象 `{ result: answer分支 | plan分支 }`，由 `sdk-runner.ts` 解包为既有
operation 合同；`workflow-runtime.ts` 继续严格校验互斥分支。该适配解决根 union 无法转换为严格
Provider schema、可选字段方案可能产生错配分支的问题；消费者仅为 SDK runner，不改变 HTTP 或 Temporal
合同。SDK 支持根 union 后重新评估此适配。Synthesizer 只使用材料已有的 citationIndex，且区分检索失败
与检索成功但无匹配，最终引用校验仍然保留。

## 编排语义

外层是带 Replanning 的自适应 Solve→Execute→Synthesize。Executor 内可以发生多轮模型—工具调用，因此局部
接近 ReAct，但本应用不实现显式 thought/action/observation 状态机。仓库没有独立 skill runtime；当前只有
workflow operation 实现，不暴露尚未有真实消费者的策略枚举。

Replanner 的 `task_replan.v2` 使用 `continue`、`synthesize` 和 `insufficient`。Runtime 只负责版本、字段、枚举、
长度和数组结构；计划预算、依赖、候选来源可用性以及 decision 与 `remainingSteps` 的语义组合由
execution-control 统一准入。`reason` 说明决策原因，不构成额外执行状态。

Executor 必须返回 `summary` 与 `remainingFacts`。Synthesis 必须声明 `answerMode`：`grounded`
要求存在证据，`insufficient` 仅适用于没有证据但至少有真实 `no_match` 的结果。

`max_model_turns` 与 `max_function_tool_calls` 按单个 operation 计数；`max_plan_steps` 与
`max_replans` 由外层 workflow 作为请求级预算执行。

## 内部边界

- `agent-run-contract.ts` 拥有 operation 输入输出合同；
- `workflow-runtime.ts` 拥有四类 operation 的指令、上下文与结果校验；
- `http-run-contract.ts` 负责 HTTP 请求校验与运行输入投影，`http-response.ts` 负责普通响应和 SSE
  wire 投影；
- `sdk-runner.ts` 只负责 OpenAI Agents SDK 与工具循环，不决定持久步骤顺序；
- Provider、工具执行和 SDK runner 依赖上述 leaf contract，不反向依赖 HTTP server。

## 入口

```bash
pnpm --filter agent-runtime dev
pnpm --filter agent-runtime build
pnpm --filter agent-runtime typecheck
pnpm --filter agent-runtime test
```

## 相关文档

- `docs/architecture/system/agent-framework.md`
- `docs/architecture/system/prompt.md`
- `docs/architecture/system/tool-routing.md`
- `docs/architecture/system/durable-runtime.md`
- `docs/reference/telemetry.md`
