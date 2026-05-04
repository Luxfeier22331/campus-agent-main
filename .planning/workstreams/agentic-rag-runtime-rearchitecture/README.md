---
doc_type: index
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Workstream: Rag-Agent Agentic Retrieval Rearchitecture

这是 `agentic-rag-runtime-rearchitecture` 的 native workstream 入口。
它负责把 `packages/rag-agent` 从当前仍偏 single-shot、shape-driven、prompt-assisted
的 retrieval specialist，重整为 planner-first、typed、bounded 的 agentic retrieval
runtime。

## Current Status

- status: `active`
- current phase: `Phase 5 next`
- active implementation: Phase 4 complete
- current slice: eval failure attribution and diagnostic performance breakdown are implemented;
  heuristic cleanup and closeout next
- current posture: stage contract, executable seam placement, `title_lookup` downgrade,
  sanitized stage diagnostics foundation, explicit planner stage, retrieval stage, and evidence
  selection stage are implemented; supporting evidence now carries retrieval plan / step /
  replan provenance; ragas diagnostics now carry failure attribution and performance breakdown;
  remaining work is final heuristic closeout.

## Why This Exists

Current `rag-agent` code still mixes:

- scope resolution
- retrieval planning
- answer-shape heuristics such as `title_lookup`
- evidence selection
- prompt synthesis fallback
- grounding / no-answer policy

That makes low answer relevancy / faithfulness scores hard to explain and hard to fix.
This workstream exists to make the runtime explicit, typed, and observable, without reopening
product surfaces or shifting ownership back into supervisor / app-api / ingestion.

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`

## Boundary Notes

- 不重开 `official_web/fresh_news`、general web fallback 或其他非 RAG serving scope。
- 不把 retrieval-core 或 `packages/contracts` 的 owner 责任反向塞回 rag-agent。
- 不把 `title_lookup` 之类 heuristics 当成长期 answer authority；它们最多只能是过渡性
  presentation hint。
- 不改写 supervisor / app-api / ingestion 的长期边界。
- 这条线的 eval 目标是解释和降低 relevancy / faithfulness failure，不是把问题改写成
  单纯 embedding provider、Qdrant 或 PyTorch 缺失告警。

## Related Architecture

- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
