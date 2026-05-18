---
doc_type: index
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Workstream: Campus Agentic RAG Depth Completion

这是 `campus-agentic-rag-depth-completion` 的 native workstream 入口。

本 workstream 负责补齐 `rag-agent` 作为 bounded campus agentic retrieval runtime 的深度缺口：
显式 planner decomposition、projection-aware evidence context、semantic replan diagnostics、
claim/evidence graph 和 eval attribution。

它不重开开放域 web search、`fresh_news`、live/latest、arbitrary URL fetch、provider web search
或产品 chat model migration。

## Current Status

- status: `completed`
- current phase: `closed`
- active implementation: none
- current slice: trace-safe semantic summaries and focused regression gates completed in current worktree

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- gap ledger: `./GAP-LEDGER.md`

## Boundary Notes

- `packages/contracts` 只能暴露安全摘要，不暴露 `RetrievalPlan`、`RetrievalStep`、
  provider SDK type、tool runtime type 或 raw projection payload。
- `rag-agent` 只能消费 bounded projection refs / summaries，不读取 raw cross-agent body。
- semantic replan 在本线先作为诊断和 eval truth 收口；不得扩大 admitted scope 或打开 live branch。
- 所有默认 query-enabled scope 仍保持现状。

## Related Architecture

- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `.planning/workstreams/agentic-rag-runtime-rearchitecture/README.md`
- `.planning/workstreams/campus-bounded-autonomous-rag-completion/README.md`

## Reopen Rule

完成后只有在 planner decomposition 再次不可观测、projection context evidence use 无法审计、
replan 原因不可归因、claim/evidence graph 缺失或 eval 无法区分 decomposition/replan/claim graph
失败时恢复。
