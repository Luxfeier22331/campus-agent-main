---
doc_type: phase_plan
phase: "D"
phase_name: "Authenticated Notice Attachment Migration"
status: completed
created: 2026-04-19
updated: 2026-04-19
---

# Phase D Plan

## Objective

把 `authenticated_notice` attachment path 真正迁到 Phase C 已提供的 shared file asset substrate，让 authenticated notice 只保留 source-specific classification / projection orchestration，而不再继续充当 file-family parser owner。

## Why This Phase Exists

Phase C 已经把 shared substrate owner 基本放到了正确位置：

- modern OOXML deterministic extraction 在 shared owner
- legacy Office normalization / extraction 在 shared owner
- text-extractable stored payload wrapper 在 shared owner
- OCR bytes bridge 在 shared owner

但 `authenticated_notice` 还没有彻底完成 consumer wiring 收口：

- source projection 仍混合 attachment policy、child document materialization 与一部分 family-level wiring
- import / closeout lane 仍要验证自己没有反向持有 source-private artifact assumptions

如果不做 Phase D，Phase C 的 shared substrate 会停留在“存在但 consumer 仍半依赖旧 owner”的状态。

## Locked Inputs

- 不重开 Phase A / Phase B 的 provider / backend decision
- 不改写 `authenticated_notice` notice-level source unit
- 不碰 `official_web`、`file_release`、regulation downstream、panel/chatbot/evals
- object storage 长期语义继续是 `S3-compatible object storage`
- 不新增兼容层或双路径，除非存在外部迁移约束

## Execution Slices

### Slice 1: Freeze Remaining Consumer Boundary

- 审计 `authenticated_notice_source_projections.py` 中剩余的 family-level helper / schema / bridge owner
- 明确保留在 source-specific boundary 的只有：
  - attachment classification
  - attachment title / relation metadata
  - restricted projection metadata
  - child-document / terminal-outcome orchestration
- 明确不再允许留在 source-specific boundary 的只有：
  - family parser dispatch truth
  - OCR bytes bridge
  - source-private stored extraction payload schema

### Slice 2: Finish Source Projection Wiring

- 让 admitted family 的 text-extractable / OCR-required path 只消费 shared substrate entrypoints
- 删除或收紧仅剩的 source-specific family wrapper，避免 `authenticated_notice_source_projections.py` 继续表现为 parser hub
- 保持 current behavioral semantics：
  - `.docx/.xlsx/.xls`
  - downloaded PDF/image OCR
  - manual review / reference only / no extractable text

### Slice 3: Align Import And Projection Artifact Semantics

- 核对 `authenticated_notice_import.py` 与 source projection child document 的 artifact key / processed object key / provider/layout artifact shape 是否完全兼容 shared ingestion support
- 若仍有 source-private field guessing，收回 `campusrag_ingestion_support.py` 或既有 artifact helpers
- 不为了 closeout convenience 引入新的 source-private payload contract

### Slice 4: Audit Closeout Wiring, But Keep It Narrow

- 审计 `authenticated_notice_closeout_execution.py` 是否仍假设 source-specific attachment payload / object-key shape
- 只在存在真实跨-consumer shared gap 时才抽 helper
- 如果剩余逻辑只是 closeout-specific staging / manifest / upload orchestration，则保留在 closeout boundary，不继续伪装成 shared substrate work

### Slice 5: Verification

- 以 authenticated notice 自身高信号回归为主：
  - `tests.ingestion.test_authenticated_notice_source_projections`
  - `tests.ingestion.test_authenticated_notice_import`
  - `tests.ingestion.test_import_authenticated_notice_export_worker`
  - `tests.ingestion.test_authenticated_notice_closeout_async`
  - 必要时加 `tests.ingestion.test_campusrag_ingestion_support`
- 验证标准：
  - admitted families 仍按现有 contract materialize / defer
  - stored provider/layout artifacts 与 processed object keys 不回归
  - closeout staged/final payload 可继续 round-trip

## Proposed Write Set

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_closeout_execution.py`
- `packages/ingestion-core/src/campus_ingestion_core/campusrag_ingestion_support.py`
- `tests/ingestion/test_authenticated_notice_source_projections.py`
- `tests/ingestion/test_authenticated_notice_import.py`
- `tests/ingestion/test_authenticated_notice_closeout_async.py`
- `tests/ingestion/test_campusrag_ingestion_support.py`

## Exit Rule

Phase D completes only when:

- `authenticated_notice` admitted attachment families 已经只消费 shared substrate，而不是继续在 source projection 内保留 parser truth
- import / projection / closeout lane 不再反向依赖 source-private attachment payload / artifact-key 假设
- 剩余留在 authenticated notice boundary 的逻辑明确是 source-specific business orchestration，而不是 shared file asset contract 漏洞
- targeted regressions 证明迁移没有改变 authenticated notice 当前 terminal semantics
