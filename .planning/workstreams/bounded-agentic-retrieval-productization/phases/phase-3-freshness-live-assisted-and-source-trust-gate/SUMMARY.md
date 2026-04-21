---
doc_type: summary
status: completed
created: 2026-04-22
updated: 2026-04-22
---

# Phase 3 Summary

## Completed Outcome

`Phase 3` 已把 generic `freshness_sensitive / live_assisted`、`freshness_gate / live_source_lookup`
与 source-trust gate 收成 `rag-agent -> retrieval-core` 的正式 typed seam。

本 phase 的关键结果不是“打开更多时效 surface”，而是把 repo 允许的 live branch 语义收口成：

- planner 可显式发出 freshness/live step
- executor 明确承担 freshness/live step 执行 owner
- live lookup 只能命中 repo-admitted channel，缺失时 fail-close
- live evidence 仍受 source-trust gate 约束

## What Was Delivered

- `packages/rag-agent/src/campus_rag_agent/retrieval_plan.py`
  - `freshness_sensitive` 会发出 `freshness_gate -> indexed_lookup`
  - `live_assisted` 会发出 `freshness_gate -> live_source_lookup -> indexed_lookup`
- `packages/retrieval-core/src/campus_retrieval_core/service.py`
  - 新增 `freshness_gate` / `live_source_lookup` execution subset
  - local freshness 不满足时会短路并 fail-close
  - live executor 缺席时返回 `live_lookup_unavailable`
- `packages/retrieval-core/src/campus_retrieval_core/models.py`
  - 冻结 `freshness_sensitive / live_assisted`
  - 冻结 `freshness_gate / live_source_lookup`
  - 冻结 `allow_live_source_lookup` / source-trust policy 约束
- `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py`
  - runtime profile 只保留 generic freshness / live posture，不再承载 official-web live target selection

## Key Decisions Confirmed

- `retrieval-core` 的 generic `live_source_lookup` seam 保留
- `official_web/fresh_news` 不再由 `rag-agent` 自动升级为 `live_assisted`
- `rag-agent` 不再拥有 repo-owned default live provider seam
- `official_web` 的时效 query 恢复为 tool/runtime owner；如果误路由到 `rag-agent`，继续 fail-close
- `live_source_lookup` 不能演化成 general web fallback

## Verification

已运行并通过：

- `uv run --all-packages python -m unittest tests.ingestion.test_corpus_runtime_profile tests.specialist.test_rag_retrieval_plan tests.specialist.test_rag_specialist tests.retrieval.test_service`
  - `Ran 196 tests`
  - `OK`
- `git diff --check -- packages/rag-agent/src/campus_rag_agent/service.py packages/rag-agent/src/campus_rag_agent/retrieval_plan.py packages/retrieval-core/src/campus_retrieval_core/service.py packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
  - 通过

## Follow-up

下一步固定进入 `Phase 4: Query Activity Evidence Selection And Observability`：

- 正式冻结 query activity / step activity 的 operator-safe 投影
- 固定 raw retrieved trace 与 final supporting evidence 的边界
- 把当前已有 eval / runtime acceptance building blocks 收口到最终 closeout 计划
