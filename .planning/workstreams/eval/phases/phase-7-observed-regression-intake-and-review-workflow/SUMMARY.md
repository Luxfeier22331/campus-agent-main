---
doc_type: phase_summary
phase: "7"
phase_name: "Observed Regression Intake And Review Workflow"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 7 Summary: Observed Regression Intake And Review Workflow

## Outcome

Phase 7 将 Phase 5A 的 pending candidate intake 补成 repo-owned review / dedupe /
admission workflow。

落地内容：

- 新增 `campus_evals.observed_regression_review`
  - 支持 `accept`、`reject`、`duplicate`、`deprecated`、`needs_info`
  - 校验 reviewer / reviewed_at / reason / target_suite
  - `duplicate` 必须记录 `duplicate_of`
  - `accept` 必须提供 rewritten `accepted_case`
- 新增 CLI：
  - `uv run --all-packages python -m campus_evals.observed_regression_review apply`
- 输出两类 artifact：
  - reviewed manifest
  - accepted observed regression fixture
- accepted fixture 不保存原始 `quality_candidate` / app-api candidate payload
- raw prompt / transcript / provider raw response / auth material / retrieval dump
  key guard 扩展到 observed regression review 与 quality candidate admission

## Boundary

本 phase 不让 app-api / panel / operator candidate 直接决定 golden truth。accepted case
必须由 eval reviewer 重写为 eval-owned case payload 后才能进入 fixture。

## Verification

已新增 observed regression review suite，并回归 eval admission 与 intent observed
regression loader。最终验证命令记录在本轮执行结果中。
