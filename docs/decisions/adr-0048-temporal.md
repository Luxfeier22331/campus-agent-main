---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0048
status: accepted
---
# ADR-0048 Temporal 执行面

## 背景

在线回答必须能跨浏览器断线继续执行，支持 cancel/timeout，并产生持久且产品安全的
projection，不能让 PostgreSQL row 或一次 HTTP request 充当 scheduler。

模型运行时还需要一套一致的 Agent/tool loop。持久执行只能包裹该循环，不能复制 semantic
routing。

## 决策

Temporal 是权威在线 workflow substrate。PostgreSQL 只保存脱敏 run/event/step/result
projection，不保存 workflow history 或 queue truth。

`ToolExecutionWorkflow` 固定为四个 phase：

1. Memory Recall；
2. 一个 Agent Activity；
3. Finalization；
4. Memory Append。

Agent Activity 只调用一次 `apps/agent-runtime`。一个 OpenAI Agents SDK run 包含 primary
agent、model-visible function tool、通过 `handoff()` 进入 Knowledge Agent、内部
`knowledge_search` 调用和 structured terminal output。

Temporal 不把 SDK handoff 或 function-tool call 展开为额外 activity。worker pool 只有：

- `workflow-worker`；
- `activity-worker-core`；
- `activity-worker-agent`。

execution-control 拥有 run admission、Temporal command/query/cancel、visible tool 与
scope/version admission、internal query、有界 evidence projection、terminal evidence/source
validation 和 finalization projection。

OpenAI Agents SDK 拥有 semantic tool selection、handoff 和 answer generation。Finalization
不调用模型、不改写 answer text；app-api 也不改写 finalized answer。

cancel/timeout 必须从 Temporal 传播到 Agent Activity 和进行中的内部或 provider call。run
已终态后，late completion 不得覆盖它。

## 后果

- 浏览器 streaming 是对持久脱敏 event 的 subscription。
- workflow/core/agent queue 可以独立扩缩容，不改变 semantic ownership。
- SDK `maxTurns` 是单次 run 内预算，不增加 workflow phase。
- SDK tool call 可以投影为 diagnostic trajectory，但不成为第二张 workflow graph。
- 缺失 Temporal、provider、internal query、scope 或 evidence truth 时失败关闭。
- 在线 indexed knowledge 不提供 live web-search fallback。

## 未采用方案

- **PostgreSQL queue**：会重复 workflow retry、timer、heartbeat 和 cancellation 语义。
- **每个工具或 specialist 一个 activity**：会拆散 SDK loop 并产生多个 semantic owner。
- **同步 HTTP 生命周期**：浏览器连接不能拥有 answer run。

## 相关文档

- `docs/architecture/system/durable-runtime.md`
- `docs/architecture/system/agent-framework.md`
- `docs/contracts/durable-runtime.md`
