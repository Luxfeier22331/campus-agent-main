---
phase: "E"
name: "Cross-Scope Adoption Matrix And Hardening"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase E Summary

## What Closed

- 把 shared file asset substrate 的当前 adoption matrix 固化成 repo-owned truth，明确区分 landed、explicit deferred 与 rerouted follow-up scope。
- 把 family tranche truth 与 source-path admitted truth 明确拆开：legacy binary Office tranche 仍包含 `.doc/.xls`，但当前 `authenticated_notice` default lane 只 admitted `docx/xls/xlsx`，`.doc` 继续 fail-close。
- 删除 `packages/ingestion-core` 中残留的 `xlrd` runtime dependency，并移除历史 `raw_asset_typing.py` / `online_ocr_routing.py` shim，避免 forward owner 漂移回旧名字。
- 冻结 shared file asset loader 的 verification matrix；确认本 phase 没有引入新的 operator step，因此不扩写 runbook。

## Fresh Evidence

- xlrd PyPI docs: https://pypi.org/project/xlrd-2024/
- `uv run --all-packages python -m unittest tests.ingestion.test_file_asset_substrate.FileAssetHardeningContractTest tests.ingestion.test_online_ocr_routing`
- `uv run --all-packages python -m unittest tests.ingestion.test_file_asset_substrate tests.ingestion.test_process_raw_ingestion_job`
- `docs/architecture/system/file-asset-loader-architecture.md`
- `docs/plans/archive/completed/shared-file-asset-loader-contract.md`

## Handoff

- 下一阶段固定进入 `Phase F: Planning Closeout And Follow-up Routing`。
- `Phase F` 只允许处理 future adoption demand / out-of-scope follow-up 的 routing，不得回退重开 `authenticated_notice` attachment substrate、provider selection 或 `official_web` / `file_release` / regulation downstream implementation。
