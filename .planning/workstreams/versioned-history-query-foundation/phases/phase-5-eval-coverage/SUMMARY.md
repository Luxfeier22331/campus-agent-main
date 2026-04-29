---
doc_type: phase_summary
phase: "5"
phase_name: "Eval Coverage"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 5 Summary

## Outcome

`versioned-history-query-foundation` 已完成最后一层 eval coverage 收口：

- `GoldenCase` 现在可以显式携带 typed `version_query`
- 新增 `versioned_history_regression_locked_cases()`
- deterministic eval 现在会显式判分：
  - `historical_grounded_answer`
  - `as_of_grounded_answer`
  - `compare_grounded_answer`
- `version_filter_unresolved` 与 `compare_support_incomplete` 已进入 fail-close regression
- handbook / curriculum legacy live executor 会透传 case 的 `version_query`
- `app-api` eval client 对 non-current case 明确 fail-fast，不再允许静默 current-only downgrade

## Implemented Surfaces

- `packages/evals`
  - `GoldenCase.version_query`
  - `semantic_outcome_accuracy`
  - `versioned_history_regression_locked_cases()`
  - legacy live executor version-query passthrough
  - app-api eval-client non-current guard
- `tests/evals`
  - versioned history inventory truth
  - version-aware semantic metric
  - fail-close retrieval adequacy regression
  - live executor passthrough / guard

## Verification

- `uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_handbook_live_benchmark tests.evals.test_curriculum_live_benchmark`

## Notes

- 本 phase 没有改产品 runtime 的 public/app-api request contract。
- “历史意图不明确的澄清”没有单独建成新的 runtime branch；这是刻意保持边界，因为 `Phase 1` 已把这条 workstream 的入口固定为 typed `version_query`。
- 至此，这条 workstream 已完成全部 5 个 phase，可按 completed truth 收口。
