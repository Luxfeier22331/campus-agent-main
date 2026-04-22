---
doc_type: phase_plan
phase: "E"
phase_name: "Cross-Scope Adoption Matrix And Hardening"
status: planned
created: 2026-04-19
updated: 2026-04-19
---

# Phase E Plan

## Objective

把 Phase A-D 已经落下的 shared file asset substrate 真实收口成 repo-owned adoption matrix / hardening truth，避免后续会话把 tranche truth、source-specific admitted truth、历史 dependency 和 compatibility shim 混成一团。

## Why This Phase Exists

Phase D 已经完成首个 source-channel migration，但还剩三类 planning drift：

- repo 内哪些 scope 已接入 / deferred 还没有 matrix 化
- docs 容易把 legacy Office tranche truth 误读成 `.doc` 已在 authenticated notice lane admitted
- `xlrd` 依赖和 compatibility shim 仍有残留，需要明确是删还是留

如果 Phase E 不做，后续很容易再次把“shared substrate 已完成”误解成“repo 所有 file-like asset 都已统一”，或者把已废弃依赖继续留成技术债。

## Locked Inputs

- 不 reopen provider / backend selection
- 不回到 `authenticated_notice` lane 继续做 parser owner 实现
- 不打开 `official_web` file adoption、`file_release`、regulation downstream、query-serving
- object storage 语义继续是 `S3-compatible object storage`
- 不新增兼容层；对已有 compatibility shim，优先删除或明确记录其存在理由

## Execution Slices

### Slice 1: Freeze Adoption Matrix Truth

- 盘点并落盘 repo 内 shared file asset substrate 的 adoption matrix：
  - landed
  - explicit deferred
  - rerouted to other workstreams
- 重点明确：
  - `raw_ingestion`
  - `authenticated_notice`
  - worker shell
  - `official_web`
  - `file_release`
  - downstream regulation consumption

### Slice 2: Harden Docs Against Tranche vs Admitted Drift

- 更新 architecture / plan / config-reference docs，使其明确区分：
  - legacy Office family tranche 包含 `.doc/.xls`
  - 当前 `internal_notice` admitted default lane 只包括 `docx/xls/xlsx`
  - `.doc` 当前仍是 explicit fail-close gap
- 目标是消除“shared family owner 已存在”与“当前 source path 已 fully admit 某 extension”之间的语义混淆

### Slice 3: Dependency And Shim Audit

- 审计 `packages/ingestion-core/pyproject.toml` 中的 `xlrd` 是否仍有真实运行时用途
- 审计 `raw_asset_typing.py` / `online_ocr_routing.py` 是否还存在外部 import 约束
- 若无实际约束：
  - 删除残留 dependency / shim
- 若仍需保留：
  - 在 docs / matrix 中明确写为 compatibility-only，不再冒充 forward owner

### Slice 4: Verification Matrix Hardening

- 固化 shared file asset loader 的 repo-owned verification matrix
- 至少明确以下命令的归属与用途：
  - `tests.ingestion.test_file_asset_substrate`
  - `tests.ingestion.test_process_raw_ingestion_job`
  - `tests.ingestion.test_authenticated_notice_source_projections`
  - `tests.ingestion.test_authenticated_notice_import`
  - `tests.ingestion.test_import_authenticated_notice_export_worker`
  - `tests.ingestion.test_authenticated_notice_closeout_async`
- 如果 Phase E 删除 dependency / shim，补对应 targeted regressions

### Slice 5: Minimal Runbook Sync Only If Operator Contract Changed

- 若 adoption matrix / docs hardening 不改变 operator steps，则不扩写 runbook
- 只有在 verification / runtime entry 真正变化时，才同步 runbook 或 architecture reference

## Proposed Write Set

- `docs/architecture/system/file-asset-loader-architecture.md`
- `docs/plans/archive/completed/shared-file-asset-loader-contract.md`
- `configs/ingestion/campus_notices/internal_notice/README.md`
- `packages/ingestion-core/pyproject.toml`
- `packages/ingestion-core/src/campus_ingestion_core/raw_asset_typing.py`
- `packages/ingestion-core/src/campus_ingestion_core/online_ocr_routing.py`
- `tests/ingestion/test_file_asset_substrate.py`
- `tests/ingestion/test_process_raw_ingestion_job.py`
- `.planning/workstreams/shared-file-asset-loader-contract/STATE.md`

## Exit Rule

Phase E completes only when:

- adoption matrix 已明确 landed / deferred / rerouted scope
- docs 已不再混淆 tranche truth 与 admitted extension truth
- `xlrd` 残留与 compatibility shim posture 已做出明确裁决
- shared file asset loader 的 verification matrix 已落盘成 repo-owned truth
- 没有把 `official_web` / `file_release` / regulation downstream 混回本 phase
