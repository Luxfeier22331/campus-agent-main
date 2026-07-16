---
doc_type: architecture
owner_boundary: tool-runtime
status: active
---
# 工具运行时

## 边界

本文拥有 SDK tool exposure 和 handler boundary。OpenAI Agents SDK 拥有在线 tool loop；
Temporal 不为每个 tool dispatch 一个 activity。

## Registry 事实

`configs/runtime/tools.v5.json` 定义 tool name、exposure、payload/result schema、handler、
timeout 和 bounded projection policy。strict function argument 位于
`configs/runtime/tool-function-schemas.v2.json`。

- `model_visible` entry 可在 run 准入后供 primary agent 使用；
- `internal_only` entry 只供所属 specialist 使用；
- contract、endpoint 或 implementation 存在都不会让 tool 自动可见。

当前具体 tool 清单以 registry 为准，不在架构文档复制。

## Handler 类型

`execution_control_internal_query` 在 SDK run 内调用带认证的 execution-control read-model
endpoint。endpoint 校验 run identity、policy 和 result shape，再返回有界 JSON。

`agent_handoff` 把 model-visible capability 映射到官方 SDK handoff；`knowledge_query` 进入
`knowledge_agent`，不是等待后续 Go execution 的 HTTP acknowledgement。

## 知识工具

handoff payload 为 `{query_text}`。Knowledge Agent 从 execution-control 获得 active target，
并在 runtime-configured search budget 内调用 internal `knowledge_search`，payload 为
`{query_text, target, include_history}`。相同 normalized 调用按合同返回 `duplicate_query`。

corpus、collection、alias、top-k、provider 和 vector-store control 由服务端拥有。search
result 只包含 outcome、target、safe result ref、计数、retriever mode 和 bounded evidence，
不暴露 raw Qdrant/provider payload。

## 投影

`tool_trajectory.v2` 区分 public `tool_calls` 和 `internal_tool_calls`。safe projection 可以
包含 tool identity、argument shape/hash、eval-safe argument、invocation id、search ordinal、
status、result kind、计数、provider/model identity 和 duration。

raw model argument、source body、credential 和 backend response 禁止进入 projection。

## 相关文档

- `agent-framework.md`
- `tool-routing.md`
- `agentic-retrieval.md`
- `../../contracts/tool-trajectory.md`
