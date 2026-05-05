---
doc_type: requirements
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Requirements: Campus Agentic RAG Depth Completion

## Goal

让当前 `rag-agent` 不只具备 planner-first runtime stage，而是具备可审计的 agentic retrieval
深度：问题分解、上游 projection 语义、replan 语义、claim/evidence graph 与 eval failure
attribution 都能在不泄漏 raw payload 的前提下进入诊断和回归。

## In Scope

- planner information needs / decomposition 的 typed safe summary。
- cross-agent projection refs 的 evidence-use summary。
- semantic replan decision summary，区分 budget / empty evidence / scope-closed / live-closed。
- claim/evidence graph summary，连接 final claim、supporting evidence id、support status 与 source trust。
- agentic retrieval eval 区分 decomposition、step plan、replan、claim graph、evidence 与 answer failures。
- focused product-path style tests for admitted RAG surfaces.

## Out Of Scope

- 打开 live/latest/freshness answer path。
- 打开 general web fallback、provider-hosted web search 或 arbitrary URL fetch。
- 将 executable retrieval-core models 暴露到 `packages/contracts`。
- 改动 product chat model 或 eval model 配置。
- 实现 peer-to-peer autonomous agent mesh。

## Success Criteria

1. Planner stage returns and diagnostics can serialize non-empty information needs for multi-part questions.
2. Diagnostics can describe admitted projection refs as context summaries without raw payload/body keys.
3. Retrieval diagnostics include semantic replan summaries when execution replans or fail-closes.
4. Grounding diagnostics include claim/evidence graph entries for supported and unsupported claims.
5. Eval failure classes separately report `decomposition_error`、`replan_error` and `claim_graph_error`.
6. Existing executable retrieval seam types remain absent from public contracts.
