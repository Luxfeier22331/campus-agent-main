---
doc_type: context
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Phase 3 Context

## Why This Phase Exists

`Phase 2` 已经把 typed retrieval plan 与 multi-step executor 接回 repo 主链路，但当前 repo 仍没有把
`freshness_sensitive / live_assisted` 与 source-trust gate 收成正式 runtime branch。

如果继续停在现在的状态，会留下三个直接问题：

- `freshness_sensitive` 仍主要靠局部 heuristics fail-close，而不是 planner/executor 明确执行
- `live_assisted` 还没有 admitted live source lookup step，无法形成稳定 runtime contract
- `source_trust_policy` 已进入 plan model，但还没有在 live branch admission 上形成 code-owned gate

因此 `Phase 3` 的目标不是再扩 generic retrieval taxonomy，而是把 freshness/live/source-trust
变成 repo-owned typed runtime branch。

## Repo Facts

- `Phase 2` 已提供：
  - `RetrievalPlan / RetrievalStep / RetrievalExecutionResult`
  - `build_ordered_retrieval_plan(...)`
  - `execute_retrieval_plan(...)`
  - bounded replan validation
- `packages/retrieval-core/src/campus_retrieval_core/models.py` 已有：
  - `query_mode = freshness_sensitive | live_assisted`
  - `step_type = freshness_gate | live_source_lookup`
  - `source_trust_policy.minimum_tier`
  - `source_trust_policy.allow_live_source_lookup`
- 当前 executor 仍只执行 `indexed_lookup`
- `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py` 当前只有
  `supports_freshness_sensitive_queries`，但还没有完整 admitted live-lookup runtime contract
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py` 与
  `packages/rag-agent/src/campus_rag_agent/service.py` 里已经存在 official-web freshness fail-close
  heuristics，但它们还不是 typed plan/step runtime branch

## Phase Boundary

本 phase 只处理：

- `freshness_sensitive / live_assisted` 的 planner/executor runtime 接缝
- admitted `freshness_gate` / `live_source_lookup` step 的首轮 execution subset
- source-trust gate 与 live branch admission
- live branch unavailable / freshness unresolved 时的 fail-close

本 phase 不处理：

- general web fallback
- unrestricted browse
- new query-enabled surface 开放
- operator 面板化 observability
- supporting evidence selection 的完整 operator projection

## Primary Implementation Constraint

这一步必须保持“repo-admitted live channel + fail-close”模型，不能把 live branch 退化成 prompt
内部黑盒浏览。

首轮实现应满足：

- planner 只在 runtime policy 明确允许时生成 `freshness_gate` / `live_source_lookup`
- executor 继续是 live lookup 的唯一 execution owner
- live lookup 命中结果仍要经过 source-trust gate，不能自动变成 answer-bearing evidence

## Phase Output

本 phase 必须产出并验证：

- freshness-sensitive query 的 typed plan / executor branch
- admitted live source lookup 的 runtime gating
- source-trust tier 与 live-branch permission 的 code-owned enforcement
- unresolved freshness / unavailable live branch 的 fail-close
