---
doc_type: plan
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Phase 3 Plan

## Objective

把 `freshness_sensitive / live_assisted` 与 source-trust gate 从当前的零散 fail-close / grounding
逻辑，收成 `rag-agent -> retrieval-core` 的正式 runtime branch，并保持 repo-admitted live channel +
fail-close 模型。

## Tasks

1. 明确 runtime admission truth
   - 盘点并补齐 runtime profile / collection policy 所需字段
   - 明确：
     - 是否支持 `freshness_sensitive`
     - 是否允许 admitted `live_source_lookup`
     - admitted live source channel ref

2. 扩 planner emission
   - 让 `rag-agent` 对 `freshness_sensitive / live_assisted` 发出显式 plan
   - 接入：
     - `freshness_gate`
     - `live_source_lookup`
   - 保持：
     - current/historical/as_of/compare 不被隐式改写成 live branch

3. 扩 executor subset
   - 在 `retrieval-core` 为 `freshness_gate` / `live_source_lookup` 增加 execution owner
   - 保持 authz / visibility / admitted scope enforcement
   - live branch unavailable 时 fail-close

4. 接入 source-trust gate
   - 将 `RetrievalSourceTrustPolicy.minimum_tier` 用于 live evidence admission
   - 不满足 minimum tier 的 live evidence 不得进入 answer-bearing evidence
   - 明确 `allow_live_source_lookup=false` 的阻断路径

5. 收口已有 heuristic
   - 把 `backend_qdrant.py` 与 `rag-agent/service.py` 中当前的官方网页 freshness fail-close
     逻辑整理到 planner/executor runtime branch 下
   - 避免继续存在“部分逻辑在 helper、部分逻辑在 typed plan”双轨

6. 补测试
   - planner:
     - `freshness_sensitive` / `live_assisted` plan emission
   - executor:
     - freshness gate satisfied / unsatisfied
     - live lookup admitted / unavailable
     - source-trust tier blocking
   - specialist:
     - live branch fail-close copy
     - no general-web fallback regression

## Constraints

- 不打开新的 query-enabled surface
- 不把 live branch 做成 unrestricted browse
- 不把 structured runtime tools 混进 retrieval taxonomy
- 不把 source-trust 只留在 answer-time 校验

## Verification

- planning artifacts:
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-3-freshness-live-assisted-and-source-trust-gate/CONTEXT.md`
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-3-freshness-live-assisted-and-source-trust-gate/RESEARCH.md`
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-3-freshness-live-assisted-and-source-trust-gate/PLAN.md`
- targeted code verification when implementation starts:
  - `uv run --all-packages python -m unittest tests.retrieval.test_service tests.retrieval.test_backend_qdrant`
  - `uv run --all-packages python -m unittest tests.specialist.test_rag_retrieval_plan tests.specialist.test_rag_specialist`
- hygiene:
  - `git diff --check` 通过

## Exit Criteria

- repo 中存在 admitted `freshness_gate` / `live_source_lookup` execution subset
- `freshness_sensitive / live_assisted` 不再只是 scattered heuristic，而是 typed runtime branch
- source-trust gate 在 live evidence admission 前显式执行
- live branch unavailable / unresolved freshness 时 fail-close
