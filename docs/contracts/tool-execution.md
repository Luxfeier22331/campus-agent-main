---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---
# 执行合同

## 边界

本文规定 `apps/app-api` 与 `apps/execution-control` 之间的私有命令和查询合同。可执行
来源是 `schemas/tool-execution.openapi.yaml`，生成的 TypeScript 与 Go 类型必须与其一致。

- app-api 拥有浏览器认证、会话事实和浏览器传输；
- execution-control 拥有准入、Temporal 生命周期、内部查询策略、终态处理和安全投影；
- agent-runtime 在单个 Temporal Agent Activity 内运行完整 OpenAI Agents SDK 循环；
- 浏览器不得直接调用本合同。

## 接口

- `POST /internal/execution/runs`
- `GET /internal/execution/runs/:runId`
- `GET /internal/execution/runs/:runId/events`
- `GET /internal/execution/runs/:runId/steps`
- `POST /internal/execution/runs/:runId/cancel`

所有私有 JSON 消息严格使用 `snake_case`。

## 创建运行

运行信封携带不可变的 run、conversation、turn、request、`owner_user_id`、`surface` 和 trace 标识，
唯一元数据字段是 `execution_payload`。嵌套的 conversation、request 和 trace 标识必须与
信封一致。

当前载荷是 `tool_execution_v2`，响应合同是
`execution_finalization_response_v3`：

```json
{
  "execution_contract_version": "tool_execution_v2",
  "response_contract": "execution_finalization_response_v3",
  "user_goal": "学生手册请假制度怎么规定？",
  "conversation_id": "conv_01",
  "request_id": "req_01",
  "safety_identifier": null,
  "trace": { "trace_id": "trace_01" },
  "context": {
    "actor": {},
    "authorization": { "retrieval_filter": {} }
  }
}
```

`tenant_id` 与 `requested_tool` 可选。普通产品聊天和当前评测运行器都不发送
`requested_tool`，由 Primary Agent 从已准入的模型可见工具中选择。该字段只为具有独立准入
合同的内部执行保留，不能提供知识目标或检索控制参数。

调用方不得发送 scope、version query、corpus、collection、top-k、provider、vector-store
或 task-queue 字段。

## 工具开放

`configs/runtime/tools.v5.json` 与
`configs/runtime/tool-function-schemas.v2.json` 是运行时工具事实：

- `knowledge_query`：参数为 `{query_text}` 的模型可见 SDK handoff；
- `transport_schedule_lookup`：模型可见的内部查询函数工具；
- `knowledge_search`：仅供 Knowledge Agent 使用，参数为
  `{query_text, target, include_history}`。

execution-control 从 `configs/runtime/query-serving-targets.v1.json` 注入目标。app-api 不
选择或校验目标。

## Temporal 与终态处理

`ToolExecutionWorkflow` 的阶段、队列和 Agent Activity 边界由
`../architecture/system/durable-runtime.md` 定义。SDK handoff 和函数调用不创建额外 Temporal
Activity。

`ExecutionFinalizationResponse` 包含所选工具、状态、答案、追问、置信度、结果、错误、
`resolved_targets[]`、会话更新和 trace 标识；可选字段包括观测摘要、工作流调用链摘要和
阶段耗时。它不返回外部平台引用或逐请求遥测控制项。

对于知识答案，execution-control 根据已完成的搜索投影校验每个终态依据引用，并派生
`result.sources` 与 `resolved_targets[]`；该阶段不调用模型，也不改写答案。

## 投影与严格性

Temporal 历史是执行事实。PostgreSQL 保存安全的 run、event、step、attempt 和 result
投影；app-api 将投影转换为 SSE 和产品响应，不重建执行状态。

HTTP `ExecutionRunStatus` 与 execution-control 内部运行状态保持一致，包含等待、准入、执行、
流式输出和终态。精确枚举、字段及响应结构只由 OpenAPI 维护；内部迁移规则见
`../data/durable-runtime.md`。

- 拒绝未知字段和 camelCase 私有消息字段；
- 生成的 TypeScript 与 Go 产物必须匹配 OpenAPI；
- schema 校验后，工具与目标准入仍由服务端拥有；
- 不提供备用 parser、别名加载器或双请求结构。

## 验证

运行 `pnpm ci:contracts`、`pnpm ci:go`，以及
`../reference/verification.md` 列出的 app-api 类型检查和测试通道。
