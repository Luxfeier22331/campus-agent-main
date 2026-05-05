---
doc_type: index
status: completed
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

- status: `completed`
- current phase: `closed`
- active implementation: none
- current slice: workstream closeout complete
- current posture: stage contract, executable seam placement, `title_lookup` downgrade,
  sanitized stage diagnostics foundation, explicit planner stage, retrieval stage, and evidence
  selection stage are implemented; supporting evidence now carries retrieval plan / step /
  replan provenance; ragas diagnostics now carry failure attribution and performance breakdown;
  `title_lookup` no longer has answer success authority; curriculum title/fact confidence can use
  answer-bearing textual support without relying solely on ingestion metadata.

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
- gap ledger: `./GAP-LEDGER.md`
- phase plans: `./phases/*/PLAN.md`

## Boundary Notes

- 不重开 `official_web/fresh_news`、general web fallback 或其他非 RAG serving scope。
- 不把 retrieval-core 或 `packages/contracts` 的 owner 责任反向塞回 rag-agent。
- 不把 `title_lookup` 之类 heuristics 当成长期 answer authority；它们最多只能是过渡性
  presentation hint。
- 不改写 supervisor / app-api / ingestion 的长期边界。
- 这条线的 eval 目标是解释和降低 relevancy / faithfulness failure，不是把问题改写成
  单纯 embedding provider、Qdrant 或 PyTorch 缺失告警。

## Reopen Rule

只有在以下情况恢复本 workstream：

- `title_lookup` 或其他 answer-shape heuristic 再次绕过 answer-bearing evidence /
  grounding 来决定 answer success。
- planner、retrieval、evidence_selection、synthesis、grounding 的 stage observability 退化成
  opaque prompt output。
- supporting evidence 丢失 retrieval plan / step / replan provenance。
- RAGAS / diagnostic report 无法再区分 retrieval、evidence selection、synthesis、
  grounding 或 diagnostic overhead。
- `RetrievalPlan / RetrievalStep / RetrievalExecutionResult` 被错误提升进
  `packages/contracts`，或 `retrieval-core` 开始拥有产品 scope / serving surface 决策。

## Related Architecture

- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
