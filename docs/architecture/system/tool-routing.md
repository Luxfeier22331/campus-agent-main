---
doc_type: architecture
owner_boundary: tool-routing
status: active
---
# 工具路由

## 边界

execution-control 接纳 run 并提供 model-visible tool；OpenAI Agents SDK 拥有 semantic tool
selection、function call 和 handoff。

## 调用顺序

```text
app-api auth/session/conversation transport
-> execution-control run 与 tool admission
-> Temporal Agent Activity
-> primary agent SDK loop
-> direct output、function call 或 Knowledge Agent handoff
-> structured terminal output
-> execution-control evidence validation 与 final projection
```

app-api 不分类 intent、不选择 knowledge target，也不维护平行 tool allowlist。execution-control
不分析用户文本来选择工具。

## Primary Agent 决策

primary agent 可以回答、澄清、拒绝、调用已开放 function tool，或通过 `knowledge_query`
handoff。handoff 只接收完整 `query_text`。

primary-agent handoff 不暴露 retrieval target、collection 或 version。Knowledge Agent 在
handoff 后收到已开放 target，并在调用 `knowledge_search` 时选择。

## 受信任 Tool Hint

私有 execution contract 可以为受信任 eval/debug call 携带 `requested_tool`。它只约束 SDK
tool choice，不选择 target、不创建 Temporal branch，也不绕过 registry/evidence validation。
普通产品 chat 不提供该字段。

`official_web` 没有 query-serving target，Knowledge Agent 无法使用。系统没有 public-web、
provider-native search 或 live-source fallback。

## 禁止形态

- primary agent 前由 app-api/execution-control 分类 intent；
- caller 选择 corpus、collection、target 或 version control；
- handoff acknowledgement 后再执行 Go semantic graph；
- per-tool Temporal activity 或 specialist queue；
- SDK terminal output 后改写答案。

## 相关文档

- `agent-framework.md`
- `tool-runtime.md`
- `agentic-retrieval.md`
- `../../decisions/adr-0075-knowledge-search.md`
