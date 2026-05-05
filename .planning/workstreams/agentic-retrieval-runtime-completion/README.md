---
doc_type: index
status: completed
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Workstream: Agentic Retrieval Runtime Completion

这是 `agentic-retrieval-runtime-completion` 的 native workstream 入口。

本 workstream 负责把已完成的 agentic RAG diagnostics / observability 进一步落到 runtime
execution truth：内部 planner decision、typed retrieval step execution、bounded semantic
replan、projection-aware planning summary、claim/evidence completion gate 与 agentic eval
typed step attribution。

它不打开 `fresh_news`、general web fallback、provider web search、arbitrary URL fetch 或
live/latest 默认路径。`freshness/live/latest` 关闭仍是当前产品设计，不作为缺口修复。

## Current Status

- status: `completed`
- current phase: `closed`
- active implementation: none
- current slice: bounded campus agentic retrieval runtime seam completed in current worktree

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- gap ledger: `./GAP-LEDGER.md`

## Boundary Notes

- executable retrieval seam types remain internal to `packages/rag-agent` and
  `packages/retrieval-core`.
- `packages/contracts` continues to expose only safe summaries.
- `rag-agent` consumes bounded `workflow_context.projection_refs` as planning framing only.
- semantic replan may append bounded indexed follow-up steps but cannot widen scope, selector,
  timeout, `top_k`, or switch to live branch.

## Related Architecture

- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/contracts/rag-agent-retrieval-plan-contract.md`
- `.planning/workstreams/agentic-rag-runtime-rearchitecture/README.md`
- `.planning/workstreams/campus-agentic-rag-depth-completion/README.md`

## Reopen Rule

Reopen only if planner decision truth again becomes diagnostic-only, admitted non-live typed
steps regress to unsupported/opaque execution, semantic replan can widen scope or budget, projection
context leaks raw payload or cannot be attributed to planning, claim/evidence gate no longer governs
completed answers, or eval cannot distinguish planner / step graph / replan / claim graph failures.
