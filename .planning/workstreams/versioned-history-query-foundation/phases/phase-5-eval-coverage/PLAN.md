---
doc_type: phase_plan
phase: "5"
phase_name: "Eval Coverage"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 5 Plan

## Objective

让 `versioned-history-query-foundation` 拥有正式、可回归的 eval surface：
case 能表达 typed `version_query`，deterministic metric 能识别 version-aware completed semantics，fail-close regression 能覆盖 unresolved / incomplete-support 两条边界。

## Why This Phase Exists

前四个 phase 已经把 runtime truth 补齐，但如果 eval 仍停留在 current-only shape，就会留下两个风险：

- repo 无法稳定回归 `historical / as_of / compare`
- future eval executor 可能无声地把 non-current case 当成 current case 发出去

## Locked Inputs

- 不改产品 query path
- 不改 app-api runtime contract
- 不重做 benchmark framework
- 只补最小 deterministic regression set

## Execution Slices

### Slice 1: Extend Eval Request Truth

- 为 `GoldenCase` 增加 typed `version_query`
- handbook / curriculum legacy live executor 透传 `version_query`
- `app-api` eval client 对 non-current `version_query` 明确 fail-fast

### Slice 2: Extend Deterministic Metric

- 为 `historical_grounded_answer`
- `as_of_grounded_answer`
- `compare_grounded_answer`

新增最小 `semantic_outcome_accuracy`

### Slice 3: Add Versioned History Regression Inventory

- 新增 `versioned_history_regression_locked_cases()`
- 覆盖：
  - `current`
  - `historical`
  - `as_of`
  - `compare`
  - `version_filter_unresolved`
  - `compare_support_incomplete`

### Slice 4: Add Focused Tests

- `GoldenCase` 接受 typed `version_query`
- versioned history inventory 字段与 fail-close truth
- deterministic metric 正确判分 version-aware completed semantics
- fail-close case 正确判分 retrieval adequacy reason
- legacy live executor 透传 `version_query`
- app-api eval client 拒绝 non-current case

## Verification Matrix

- eval schema verification
  - case 可以表达 typed `version_query`
- semantic verification
  - completed version-aware answer 会被显式判分
- fail-close verification
  - unresolved / compare incomplete 都进入 deterministic regression
- boundary verification
  - app-api eval path 不会静默丢失版本条件

## Proposed Write Set

- `packages/evals/src/campus_evals/models.py`
- `packages/evals/src/campus_evals/expectations.py`
- `packages/evals/src/campus_evals/scenarios.py`
- `packages/evals/src/campus_evals/app_api_chat_runtime.py`
- `packages/evals/src/campus_evals/handbook_live_benchmark.py`
- `packages/evals/src/campus_evals/curriculum_live_benchmark.py`
- `tests/evals/test_golden_cases.py`
- `tests/evals/test_handbook_live_benchmark.py`
- `tests/evals/test_curriculum_live_benchmark.py`

## Exit Rule

Phase 5 完成后，repo 应达到：

- versioned-history eval case 已能表达 typed version mode
- `historical / as_of / compare` 不再只靠 answer 文本做隐式回归
- unresolved / compare incomplete 已进入 fail-close regression
- app-api eval path 对当前不支持的 non-current case 明确 fail-fast
