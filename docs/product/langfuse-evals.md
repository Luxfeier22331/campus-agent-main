---
doc_type: product_requirement
owner_boundary: docs/product
status: active
---

# Langfuse 评测产品需求

## 目标

工程和评测人员应在 Langfuse 中查看同一条真实产品 trace、dataset run、Ragas score 和
annotation 工作流，仓库不再建设第二套评测平台。

## 要求

- Agent SDK 与 execution span 使用同一 W3C trace identity；
- 每个 RAG collection 对应一个 Langfuse dataset；
- dataset run 通过真实 app-api、Temporal 和 Agent SDK 路径执行；
- 每个评分 turn 通过官方 dataset-run-item API 关联真实 product trace；
- 只发布已登记的 Ragas RAG、Agent/tool 和确定性 score；
- experiment、annotation queue 和分析使用 Langfuse 官方能力；
- self-hosted Langfuse 可以在受信任边界保存用户关联、模型输入输出、memory 和已授权检索事实；
- credential 和 secret 不得进入 trace、dataset 或 score；
- app-api 和 Ops Web 不复制 Langfuse observation 正文；
- Langfuse 不可用不得阻塞在线回答。

## 覆盖范围

`campus/agent/routing` 覆盖直接回答、function tool、Knowledge Agent handoff、target 选择、
会话跟进、多意图、关闭来源、过期上下文和 prompt injection。

`campus/rag/*` 覆盖当前/历史模式、单 target、跨 target、搜索次数、hard negative、
no-answer、grounding 和来源完整性。

工具行为必须来自 `tool_trajectory.v2`，答案、context、document ID 和 resolved target 来自
`agent_runtime_eval_projection.v2`；不得从答案措辞猜测调用轨迹。

## 非目标

- Langfuse 不拥有 Temporal history、产品存储或发布决定；
- Ragas score 不形成仓库自研 release gate；
- 不恢复 broad Python eval、私有 Ragas API、自研 retrieval metric 或 experiment orchestration；
- 不在产品数据库镜像 Langfuse score、dataset 或 annotation。

## 验收

- `pnpm ci:eval` 在不访问外部服务时通过；
- dataset 和 score config sync 支持 dry-run；
- manifest 同时发现 Agent 与 RAG `cases.v1.json`；
- trace/dataset scoring 拒绝缺失关联标识、缺失 materialized 字段、secret-bearing payload 和未知
  score；
- Agent 评分使用 Ragas 官方 tool metrics；
- dataset run identity 由 Langfuse 返回，score payload 只包含一个 observation 或 trace ID。

## 相关文档

- [Langfuse 架构](../architecture/system/langfuse.md)
- [Langfuse 合同](../contracts/langfuse-runtime.md)
- [评测口径](../reference/eval.md)
- [Ragas 操作](../runbooks/ragas.md)
