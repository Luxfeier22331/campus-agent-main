# Quick Task 260411-sru Summary

## Outcome

- 已冻结 `regulations/scoped_rules` 作为统一 holding collection
- `annual_cycle_rule` / `time_bound_operational_rule` 的当前策略改为 import-first
- 详细 query semantics 明确降级为 future reopen note，不再是当前 gate

## What Changed

- 新增 ADR：
  - `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`
- 新增 scaffold：
  - `configs/ingestion/regulations/scoped_rules/*`
- 同步更新：
  - `docs/architecture/current-architecture.md`
  - `docs/README.md`
  - `docs/reference/internal-notice-manual-review-collection-strategy.md`
  - `docs/reference/internal-notice-manual-review-future-query-contract.md`
  - `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`
  - `configs/ingestion/campus_notices/internal_notice/README.md`
  - `.planning/STATE.md`

## Remaining Gap

- current code still routes these docs to `manual_review_required` in the read-only manifest path
- next repo-local implementation step is `scoped_rules` materialization / chunk-prep import path
