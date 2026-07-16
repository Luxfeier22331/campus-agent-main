---
doc_type: architecture
owner_boundary: knowledge-agent
status: active
---
# Knowledge Agent 检索

## 边界

本文定义 Knowledge Agent 如何规划有界搜索并消费受治理 evidence。Knowledge Agent 与
primary agent 位于同一 OpenAI Agents SDK run，不建立 Temporal retrieval graph、外部
planner、synthesis activity 或 specialist queue。

## 入口与上下文

primary agent 使用官方 `knowledge_query` handoff，payload 为 `{query_text}`。
execution-control 从 `configs/runtime/query-serving-targets.v1.json` 提供 active target id 和
description。

Agent 不接收 corpus、collection、serving config path、Qdrant alias、embedding profile、
top-k 或 source body。

## 搜索循环

Knowledge Agent 只能调用：

```json
{
  "query_text": "focused retrieval query",
  "target": "student_rules",
  "include_history": false
}
```

它每次搜索一个 target，evidence 充分后停止。只有结果不足时才能 reformulate query 或切换
target；`include_history=true` 仅用于明确的 prior-version、as-of-date 或 comparison question。

最大搜索次数来自 execution-control runtime config。相同 normalized target/query/history
调用返回 `duplicate_query` 并消耗预算；预算耗尽返回 `search_budget_exhausted`。

Agent 只能使用本次 run 返回的 evidence，并提供所有 supporting evidence ref。搜索成功但
证据不足时返回 `unsupported_by_evidence`，不能用模型记忆补齐。

## 搜索准入

execution-control 校验 run/request/trace/invocation identity、search ordinal、target registry
membership、visibility/entitlement、serving config/vector compatibility、history mode 和
result size，随后执行 query embedding、Qdrant dense/sparse retrieval、native RRF fusion 和
有界 evidence shaping。

## Evidence 合同

result outcome 包括 `found`、`no_evidence`、`duplicate_query` 或
`search_budget_exhausted`，并携带 resolved target、history mode、计数、retriever mode、
safe search ref 和有界 evidence item。

evidence 保存 stable evidence/document/chunk id、target、title、有界 snippet、canonical URL、
可选 version id、rank 和 fusion score。raw vector、Qdrant point 和 provider response 不进入
SDK context。

## Finalization 与评测

execution-control 根据本 run 已完成 search 校验 terminal evidence ref，生成
`resolved_targets[]` 和 browser-safe source，不修改 answer。

`tool_trajectory.v2` 分别记录 public handoff 和 internal search；eval projection 为
Langfuse/Ragas 提供 answer、retrieved context、document id 和 resolved target。

## 相关文档

- `retrieval-serving.md`
- `tool-routing.md`
- `../../contracts/tool-trajectory.md`
- `../../reference/eval.md`
