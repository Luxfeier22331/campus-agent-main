---
doc_type: architecture
status: active
created: 2026-06-09
updated: 2026-06-09
---
# Memory Plane Architecture

本文冻结 `campus-agent` 的长期 memory supporting architecture。它描述目标边界，不声明当前
merged implementation 已完整具备这些能力；当前实现状态继续以
`../current-architecture.md` 与代码事实为准。

## Positioning

Memory Plane 的目标是让少量长期有用信息变成用户可控、执行可消费、出错可定位的 product
memory。它不是 agent memory 框架拼盘，也不是全量审计系统。

长期 owner 固定为：

- `apps/app-api` owns Memory Plane、用户治理 API 与 product mutation。
- PostgreSQL owns memory product truth 与 read projection。
- Temporal orchestrates background memory lifecycle workflows.
- `apps/execution-control` / RAG only consume bounded memory packets.
- panel / eval may consume sanitized memory refs for diagnosis.

因此：

- canonical memory truth 不进入 `execution-control`、RAG worker、Qdrant
  institutional index 或外部 memory SDK。
- Temporal 不是 memory database；Temporal 只编排异步、可重试、可取消的后台流程。
- Zep、Graphiti、LightMem、Mem0、A-MEM 只能作为 external reference，不是 canonical owner
  或组合式目标架构。

## Memory Classes

目标 memory 分成四类，治理强度必须不同。

- `session memory`: 当前对话连续性、summary、confirmed slots。由
  conversation runtime 自动维护，短期、轻量，不需要用户逐条确认。
- `saved/profile memory`: 长期偏好、目标、背景。由用户显式写入，或在用户确认
  candidate 后写入。用户可查看、编辑、删除。
- `inferred candidates`: 模型从完成 run 中提出的长期记忆候选。后台生成
  `memory_candidates`，保持 pending，用户确认后才生效。
- `execution memory refs`: 某次 run 实际注入的长期记忆引用。由 app-api
  构造执行输入时记录，只保存 id/hash/stage，用于 badcase 定位。

Memory 只允许影响 personalization 与 applicability，例如 query rewrite、ranking bias、
clarification wording、answer wording 和默认假设。它不得授予 authorization、restricted
visibility、tool permission、approval permission 或 runtime serving surface。

## Runtime Flow

在线回答只消费 bounded `MemoryContextPacket`，不让 worker 反向读取 raw memory store。

```text
user request
-> app-api reads identity/session/profile memory
-> app-api builds MemoryContextPacket
-> execution-control starts Temporal workflow
-> RAG consumes bounded packet
-> run projection records used_memory_ids/hash
```

`MemoryContextPacket` 只包含最小 typed projection：

- stable actor/principal reference
- relevant user-visible saved memory refs and summaries
- source type、confidence、last verified / staleness summary
- session summary / confirmed slots
- authorization snapshot reference supplied separately by app-api

它不得包含 raw long-term memory dump、raw transcript、raw auth material、provider trace、
unbounded private notes 或 product-layer DB rows。

## Background Lifecycle

长期 inferred memory 采用 candidate-first，不允许模型在线直接修改 active profile memory。

```text
run completed
-> optional Temporal MemoryCandidateWorkflow
-> extraction/dedupe/forbidden-authz check
-> memory_candidates
-> user accept/reject/edit
-> app-api materializes active memory
```

Temporal 只参与这些后台流程：

- memory candidate extraction after completed runs
- duplicate / merge candidate detection
- forbidden authorization-key check
- stale check / batch consolidation
- cleanup, retry, timeout, and failure projection for long-running memory jobs

Temporal 不参与这些 product mutation 或 read paths：

- 用户显式 `remember this` 直接保存
- 用户 edit / delete / disable memory
- app-api 读取 memory 构造 execution input
- 普通 session summary 更新
- canonical memory truth 查询

显式用户写入和删除都应是 `app-api -> PG` product mutation。后台 workflow 可以提出候选或诊断，
但不能绕过用户治理直接升级为 active long-term memory。

## Data Shape

目标 schema 以轻量 product memory 为主，不先建全量 conflict graph。

- `memory_items`: active saved/profile memory；保存 owner、key、value、source type、
  confidence、status、created/updated/last verified。
- `memory_candidates`: inferred or suggested long-term memory；保存 source run、proposal、
  reason、status。
- `run_memory_refs`: execution injection record；保存 run id、memory item id/hash、
  usage stage。

只有当真实 badcase 证明冲突、替代、重复关系需要结构化查询时，才新增
`memory_relations`，例如 `supersedes`、`conflicts_with`、`duplicates`。这不是第一阶段
默认能力。

## Guardrails

- Do not adopt an external memory SDK as canonical owner.
- Do not write personal memory into institutional Qdrant indexes.
- Do not let `execution-control`, RAG workers, or provider adapters write active
  long-term memory.
- Do not store raw transcript as long-term memory truth.
- Do not build compliance-style full audit graphs for session memory.
- Do not require Temporal workflow participation for every memory mutation.
- Do not let memory authorize, widen retrieval visibility, or open restricted
  capability surfaces.

The intended observability level is provenance-lite: users can see and manage saved
memory; operators and eval can identify which long-term memory refs influenced a
run; short-lived session memory remains lightweight.
