---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0075
status: accepted
---
# ADR-0075 基于目标的知识搜索

## 背景

Knowledge Agent 需要能够重写问题并搜索多个受治理知识面。旧合同让 caller/handoff 参数
携带 retrieval scope 和 version control，导致产品 transport 参与 retrieval planning、重复
serving policy，并把一个知识问题绑定到预选 collection。

仓库不需要兼容旧合同。

## 决策

OpenAI Agents SDK 是唯一 semantic agent/tool loop。primary agent 可以直接回答、调用
model-visible function tool，或使用官方 `knowledge_query` handoff；handoff payload 只包含
`query_text`。

execution-control 加载 `configs/runtime/query-serving-targets.v1.json`，把已开放 target id 和
description 注入 Knowledge Agent context。Knowledge Agent 只能调用 internal
`knowledge_search`，payload 固定为 `{query_text, target, include_history}`。search 和 SDK
turn limit 来自 execution-control `agent_runtime` config。

Agent 每次搜索一个 target，证据充分后停止，不重复 normalized target/query/history 完全相同
的调用。重复调用返回 `duplicate_query`，并消耗一个 search slot。

target registry entry 把一个 semantic id 映射到一个 `collection` 和一份 server-owned
serving config，不重复 `corpus`。execution-control 必须验证 registry collection 与 serving
config 一致。模型和 app-api 不接收 corpus、collection、alias、top-k、embedding 或
vector-store control。unknown target 失败关闭。`include_history=false` 搜索当前文档；历史
或比较问题由 Knowledge Agent 显式选择 historical lookup。

execution-control 校验 run identity 和 retrieval access，执行 query embedding 与 Qdrant
dense/sparse retrieval，再使用 native RRF fusion。不提供 custom reranker、version resolver、
release guard 或 fallback retrieval path。Finalization 根据已投影 search result 校验 terminal
evidence ref，并生成 browser-safe source，不改写答案。

完整 primary/Knowledge Agent run 仍是四阶段 Temporal workflow 中的一个 Agent Activity。
SDK handoff 和 search 不创建额外 Temporal activity。

## 未采用方案

- **Caller 选择 scope/version**：会让 product/eval caller 成为 retrieval planner。
- **工具参数暴露 raw collection control**：会绕过 target admission 并泄露 data-plane
  topology。
- **Go 自建 retrieval planner**：会复制 Knowledge Agent semantic loop。
- **自研 reranker/release guard**：当前 Qdrant hybrid fusion 和 serving registry 已拥有对应
  边界。

## 后果

- runtime tool truth 来自版本化 tool registry 和 function schema。
- query-serving truth 是 target registry，不是 model-facing scope registry。
- multi-target 和 follow-up search 是普通有界 SDK tool call。
- deadline、turn/output、search 和 context limit 是必需 runtime config，不是 prompt 或
  request-scoped env。
- search result 只暴露有界 evidence 和 stable ref，不暴露 retrieval infrastructure。
- tool eval 通过 `tool_trajectory.v2` 观察公开 handoff 和内部 search sequence。
- source 在拥有 published target 和 serving config 前保持 unavailable。
