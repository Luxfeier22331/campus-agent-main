---
phase: "G"
name: "OCR Lane-First Provider Contract Realignment"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase G Summary

## What Closed

- 收口了 shared OCR routing owner 与 runtime/env/runbook/test/planning 之间残留的 provider-first 漂移。
- `authenticated_notice_source_projections.py` 不再把 `paddleocr_async_jobs` 写成 replay 唯一 canonical provider；MinerU provider 结果会先适配成 canonical provider payload，再进入既有 attachment artifact/materialization 流程。
- `raw_ingestion.py` 不再把 `mineru_api` 视为 compare-only primary forbidden mode；`source_truth_only` 现在按 lane-first routing 解释当前已配置 provider 集合，并在需要时先把 MinerU 结果归一化后再进入下游。
- env/docs/runbook/template 已不再把 `OCR_MINERU_*` 表达成 repo-level “second provider canonical truth”，也不再把 authenticated-notice replay 固定写成 `OCR_PROVIDER_MODE=paddleocr_async_jobs`。
- 这条 reopen 的 drift 已经真正落到代码、测试和 planning closeout truth，因此 `shared-file-asset-loader-contract` workstream 可以恢复为 completed 状态。

## Fresh Evidence

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `tests/ingestion/test_authenticated_notice_source_projections.py`
- `tests/ingestion/test_process_raw_ingestion_job.py`
- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `docs/environment/README.md`
- `docs/environment/provider-and-secret-inventory.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-pilot-runbook.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/shared-file-asset-loader-contract/ROADMAP.md`
- `.planning/workstreams/shared-file-asset-loader-contract/STATE.md`
- `docs/plans/archive/completed/shared-file-asset-loader-contract.md`

## Verification

- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections`
- `uv run --all-packages python -m unittest tests.ingestion.test_process_raw_ingestion_job`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections tests.ingestion.test_process_raw_ingestion_job tests.ingestion.test_online_ocr_routing`

## Next State

- `shared-file-asset-loader-contract` 当前重新回到 completed workstream truth。
- future reopen 只允许发生在：
  - 新的 repo-level file-like asset adoption demand 被提升为 active
  - admitted family truth 被显式改写
  - lane-first OCR provider contract 再次出现 architecture/runtime/env/runbook/test/planning 漂移
  - `official_web` linked-file adoption、`authenticated_notice file_release` 或 semantic-image enrichment 被重新 admission 为 active implementation
