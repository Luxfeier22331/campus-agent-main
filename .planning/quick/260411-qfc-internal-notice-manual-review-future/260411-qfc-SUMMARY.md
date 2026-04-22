# Quick Task 260411-qfc Summary

## Outcome

- 已冻结 `annual_cycle_rule` 与 `time_bound_operational_rule` 的 future query contract
- 当前 repo 仍不为这两个 bucket 新建 collection scaffold
- future reopen 现在必须同时满足：
  - semantic owner / product entry
  - query-planning policy
  - metadata pre-filter projection

## What Changed

- 新增文档：
  - `docs/reference/internal-notice-manual-review-future-query-contract.md`
- 同步更新：
  - `docs/README.md`
  - `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`
  - `configs/ingestion/campus_notices/internal_notice/README.md`
  - `.planning/STATE.md`

## Frozen Decision

- `annual_cycle_rule` 默认必须 `explicit_year_only`
- `time_bound_operational_rule` 默认必须 `include_with_warning`
- `current / historical / as_of / compare` 都必须在 retrieval 前完成 year/site/time-window 约束，而不是回答后补救
