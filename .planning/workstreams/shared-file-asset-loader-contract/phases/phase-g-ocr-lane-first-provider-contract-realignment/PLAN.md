---
doc_type: phase_plan
phase: "G"
phase_name: "OCR Lane-First Provider Contract Realignment"
status: completed
created: 2026-04-19
updated: 2026-04-20
---

# Phase G Plan

## Objective

把 shared file asset OCR contract 从当前残留的 provider-first 实现/文档/测试口径，重新收口回 lane-first canonical truth。

## Why This Phase Exists

当前 repo 已经不是单纯“MinerU 没接环境变量”。

真正的 drift 是：

- shared routing owner 已经支持 `pdf/complex image -> MinerU primary, Paddle fallback`
- runtime shell、env docs/templates、authenticated-notice replay shell、runbook、doctor env、tests 与 planning closeout 却仍把 Paddle 写成 canonical primary provider

如果这条 drift 不单独成 phase，后续会继续出现：

- 代码 owner 和 operator contract 各说各话
- 新会话沿着 env 模板继续扩建 provider-first 语义
- completed workstream 冒充已经收口

## Locked Inputs

- lane-first OCR routing truth 以 `file_asset_routing.py` 和 shared file-asset architecture 为准
- provider / deployment mode 不得反向定义 asset family 或 canonical lane
- `ocr_required`、`manual_review_required`、`reference_only`、`unsupported_binary` 这些 repo-owned terminal semantics 不改
- 不打开 `official_web` linked files、`file_release`、semantic-image enrichment、regulation downstream 或 query-serving
- 不新增临时兼容层；优先直接修正错误 contract

## Execution Slices

### Slice 1: Freeze The Canonical OCR Contract

- 对齐并裁决以下文档之间的冲突：
  - `docs/architecture/system/file-asset-loader-architecture.md`
  - `docs/architecture/domains/authenticated-notice/architecture.md`
  - `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
  - `.planning/workstreams/authenticated-notice-regulation-consumption/REQUIREMENTS.md`
- 明确写清：
  - `pdf`
  - simple/generic image
  - complex document image
  - spatial/manual assets
  的 lane-level canonical provider truth

### Slice 2: Refactor Runtime And Env Contract

- 收口 `raw_ingestion.py` 的 OCR settings / provider gating，使其不再把 Paddle 写成 canonical primary provider 前提
- 重写 env contract、root `.env.example`、command-scoped env templates 与 environment docs，移除“`OCR_MINERU_*` 是 second provider canonical truth”的表述
- 保证 operator 看到的是 routed/lane-first contract，而不是 provider-first contract

### Slice 3: Realign Authenticated-Notice Replay Shell

- 去掉 `authenticated_notice_source_projections.py` 中对 `paddleocr_async_jobs` 的硬编码 canonical gate
- 同步 replay runbook / pilot runbook，不再把 Paddle 写成唯一 canonical operator setting
- 保持 fail-close 和 provider breach audit 语义不变

### Slice 4: Repair Tests And Doctor Gates

- 更新 `tests/ingestion/test_process_raw_ingestion_job.py`
- 更新 `tests/ingestion/test_authenticated_notice_source_projections.py`
- 更新 `tests/test_doctor_env.py`
- 审计其他仍把 Paddle 写成 canonical default 的测试 / fixtures / helper wording
- 目标是让测试守护 lane-first contract，而不是守护旧 provider-first contract

### Slice 5: Re-close Workstream Truth

- 更新 `shared-file-asset-loader-contract` workstream 的 state/roadmap/summary truth
- 只有在 code + env + docs + tests 都一致后，才允许再次 closeout

## Proposed Write Set

- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `docs/environment/README.md`
- `docs/environment/provider-and-secret-inventory.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-pilot-runbook.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/REQUIREMENTS.md`
- `.env.example`
- `env/commands/process-raw-ingestion-job.env.example`
- `tests/ingestion/test_online_ocr_routing.py`
- `tests/ingestion/test_process_raw_ingestion_job.py`
- `tests/ingestion/test_authenticated_notice_source_projections.py`
- `tests/test_doctor_env.py`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/shared-file-asset-loader-contract/STATE.md`
- `.planning/workstreams/shared-file-asset-loader-contract/ROADMAP.md`
- `docs/plans/archive/completed/shared-file-asset-loader-contract.md`

## Exit Rule

Phase G completes only when:

- shared OCR contract 已明确回到 lane-first truth
- `raw_ingestion.py` 与 authenticated-notice replay shell 不再要求 Paddle 作为 canonical primary provider
- env docs/templates 不再把 MinerU 定义成 repo-level "second provider" canonical truth
- runbook、doctor env 与 tests 全部和 shared routing owner 一致
- workstream state 不再错误宣称这条线已提前收口
