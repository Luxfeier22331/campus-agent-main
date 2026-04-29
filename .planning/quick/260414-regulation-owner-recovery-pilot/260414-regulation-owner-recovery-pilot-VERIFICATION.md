# Quick Task 260414-regulation-owner-recovery-pilot Verification

## Commands

1. `uv run --all-packages python .planning/quick/260414-regulation-owner-recovery-pilot/owner_recovery_pilot.py --output-dir .planning/quick/260414-regulation-owner-recovery-pilot/run-output`
2. `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections tests.ingestion.test_internal_notice_regulation_promotion`
3. `uv run --all-packages python .planning/quick/260414-regulation-owner-recovery-pilot/owner_recovery_pilot.py --output-dir .planning/quick/260414-regulation-owner-recovery-pilot/run-output-fixed`

## Results

### 1. Owner recovery pilot

- `run-output` 证明：
  - `355282` 的 attachment bytes 可离线恢复出 child document
  - 但老实现会在 promotion 阶段丢失 `source_attachment_sha256`
  - 因此 `355282` 会被错误降成 `manual_review_required`
- `351119` 在同一轮仍然明确卡在 `file_release_backed_regulation_body_missing`

### 2. Regression tests

- `tests.ingestion.test_authenticated_notice_source_projections`
- `tests.ingestion.test_internal_notice_regulation_promotion`
- fresh result:
  - `Ran 49 tests in 0.576s`
  - `OK`

### 3. Fixed owner recovery pilot

- `run-output-fixed` 证明：
  - `355282` 现已恢复为 `promote_candidate`
  - `source_attachment_sha256=1df2ea505dc7e5db04474fa3de2c44726de158e6fb215b55ce86ed375b508735`
  - parent notice 继续 `hold_in_internal_notice`
  - `351119` 仍然 blocked，原因未变：`file_release_backed_regulation_body_missing`
