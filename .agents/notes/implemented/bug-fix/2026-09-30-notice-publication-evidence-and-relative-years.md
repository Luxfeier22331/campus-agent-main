# Agent Note: 通知发布时间证据与相对年份查询

Status: implemented

## 背景

通知正文已经进入统一 Campus RAG 索引，但检索制品没有继续携带数据库中的 `released_at`，回答阶段无法区分
通知发布时间与正文中的适用年度、学期或申请窗口。另一个可复现缺陷是用户使用“去年”等相对年份时，召回查询
已经解析了年份而 rerank 仍使用原始表达，导致不同年度通知混入候选。

## 决策

- 本地 Notice Chunk Run 使用 `notice_chunk_run.v2`，每个 chunk 以 `releasedAt` 保留来源通知的 RFC3339 UTC 发布时间。
  Serving 沿用[分块与完整证据发布](../architecture/2026-09-29-notice-chunk-v9.md)的 `notice_embedding_set.v2`，
  直接引用 chunks；完整证据和发布时间同时传递到 point。
- Unified RAG point 升级为 `campus_rag_point.v3`，Notice payload 传递 `released_at`；发布时间不进入
  `retrievalText`，不触发单独的 embedding 输入，也不作为通知过滤条件。
- `campus-search-tool-contracts.v5`、WorkflowEvidence 和 finalization source card 继续传递该字段；旧的
  v1/v2 Qdrant Notice point 保留读取能力，旧点没有发布时间时结果省略该字段。
- `今年`、`去年`、`前年` 仅基于 Durable Run 的冻结创建时间转换为具体年份，并对 retrieval query 和
  rerank query 使用同一个转换结果；其他相对时间不作推断。
- Prompt 将发布时间限制为发布时间证据；没有正文适用信息时，回答说明无法确认，不从发布时间推断当前有效性。

## 未采用方案

- **把发布时间拼进 embedding 文本**：会让只改变 metadata 的通知产生新的向量输入，不能改善适用期判断，且
  增加无关召回信号。
- **按发布时间自动过滤旧通知**：发布时间不等于适用期，历史通知仍可能是用户明确询问的目标。
- **用执行时系统时间解析相对年份**：重试或延迟执行可能跨年；run 创建时间已经是现有持久化合同中的冻结时间。
- **把所有时间表达式都自动解析**：仅“今年/去年/前年”有当前缺陷证据，扩大规则会把未知适用语义误当作年份。

## 后果

通知结果现在可以显示发布时间并保留未知适用信息；新 point 和工具合同需要按 v3/v5 发布。发布时间变更不会
单独造成 embedding 重算，现有按 `retrievalTextSha256` 的缓存复用仍然有效。在线检索仍召回已发布通知的完整范围，
相对年份的召回和 rerank 语义保持一致。
