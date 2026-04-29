---
phase: "5"
name: "Eval Coverage"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 5 Context

**Gathered:** 2026-04-21
**Status:** Completed

<domain>
## Phase Boundary

本 phase 只负责：

- 为 `versioned-history-query-foundation` 增加最小、正式的 eval coverage
- 让 eval case 可以显式携带 typed `version_query`
- 把 `historical / as_of / compare` 的 answer semantics 编进 deterministic regression
- 把 `version_filter_unresolved` 与 `compare_support_incomplete` 编进 fail-close regression

它不负责：

- 改产品 runtime 的 query path
- 改 `app-api` chat route 的 public request contract
- 扩写 freshness / live retrieval
- 把 typed version query 回退成 prompt 文本歧义解析

</domain>

<current_truth>
## Current Truth

- `Phase 1-4` 已冻结：
  - typed `version_query`
  - registry-backed version resolution
  - retrieval pre-filter
  - version-aware answer semantics
- 进入本 phase 前，eval surface 仍缺三处关键缺口：
  - `GoldenCase` 不能表达 `version_query`
  - eval metric 没有锁住 `historical_grounded_answer / as_of_grounded_answer / compare_grounded_answer`
  - `app-api` eval client 若未来被喂入 non-current case，会静默丢失版本条件

</current_truth>

<decisions>
## Working Decisions

- **05-01:** Phase 5 只补 repo-owned deterministic eval lane，不把这次工作扩成 app-api runtime contract 改造。
- **05-02:** `GoldenCase` 要显式拥有 typed `version_query`，不能把版本模式藏在 `metadata` 或 prompt 文本里。
- **05-03:** 对 `historical / as_of / compare` 新增最小 `semantic_outcome_accuracy` deterministic metric，而不是复用 current-only 的 `false_refusal_rate`。
- **05-04:** version-aware eval inventory 单独建成 `versioned_history_regression_locked_cases()`，不混入现有 handbook live release gate。
- **05-05:** `app-api` eval client 对 non-current `version_query` 明确 fail-fast；当前 repo 不允许它静默降级成 current-only request。
- **05-06:** “历史意图不明确的澄清”不在本 phase 内单独建 case，因为 `Phase 1` 已把这条 workstream 的入口固定为 typed `version_query`，不再依赖 prompt 文本猜测。

</decisions>

<specific_gaps>
## Specific Gaps

- 现有 regression case 不能描述 `current / historical / as_of / compare` 四种 typed mode。
- `evaluate_case(...)` 对 versioned completed answer 还没有显式 semantic metric。
- handbook / curriculum 的 legacy live executor 没有把 case 上的 `version_query` 透传到 `RagRequestPayload`。
- 当前最危险的问题不是“没有更多 case”，而是“即使写了 case，也不能正式表达或执行版本条件”。

</specific_gaps>

<canonical_refs>
## Canonical References

- `.planning/workstreams/versioned-history-query-foundation/ROADMAP.md`
- `.planning/workstreams/versioned-history-query-foundation/STATE.md`
- `.planning/workstreams/versioned-history-query-foundation/phases/phase-4-specialist-answer-semantics/SUMMARY.md`
- `docs/plans/archive/completed/versioned-history-query-foundation.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `packages/evals/src/campus_evals/models.py`
- `packages/evals/src/campus_evals/expectations.py`
- `packages/evals/src/campus_evals/scenarios.py`
- `packages/evals/src/campus_evals/handbook_live_benchmark.py`
- `packages/evals/src/campus_evals/curriculum_live_benchmark.py`
- `packages/evals/src/campus_evals/app_api_chat_runtime.py`
- `tests/evals/test_golden_cases.py`
- `tests/evals/test_handbook_live_benchmark.py`
- `tests/evals/test_curriculum_live_benchmark.py`

### Web Sanity-Check References

- `https://platform.openai.com/docs/guides/evals`
- `https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/evaluation-evaluators/rag-evaluators`

</canonical_refs>
