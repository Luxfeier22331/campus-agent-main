---
phase: "G"
name: "OCR Lane-First Provider Contract Realignment"
created: 2026-04-19
updated: 2026-04-19
status: planned
---

# Phase G Context

**Gathered:** 2026-04-19
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 收口 shared file asset OCR contract 的 lane-first canonical truth
- 修正 `raw_ingestion.py`、`authenticated_notice_source_projections.py`、env contract、runbook、tests 与 planning closeout 中遗留的 provider-first 语义
- 让 runtime shell 和 operator contract 服从 `file_asset_routing.py` 已落盘的 shared OCR routing owner

它不负责：

- 重新做 PDF / image backend benchmark
- 重新打开 `official_web` linked-file adoption、`authenticated_notice file_release`、semantic-image multimodal enrichment
- 打开 regulation downstream、query-serving 或 collector live run
- 把 provider response 反向升级成新的 canonical data-plane layer

</domain>

<decisions>
## Implementation Decisions

- **G-01:** `docs/architecture/file-asset-loader-architecture.md` 与 `file_asset_routing.py` 当前表达的 lane-first OCR routing truth 是本 phase 的主锚点；后续实现、env 和 runbook 必须服从这条 shared owner，而不是继续沿着 `Paddle primary + MinerU supplemental` 的旧口径扩建。
- **G-02:** `authenticated_notice` source architecture、ADR-0033、env docs、runbook 和 tests 中凡是把 Paddle 写成 canonical primary provider 的表述，都必须视为 drift 审核，而不是继续当作默认 operator truth。
- **G-03:** 本 phase 必须显式区分两层概念：
  - lane-level canonical provider selection
  - provider credential / deployment wiring
  不能再用 provider-first env 命名反向定义 lane truth。
- **G-04:** `Phase F` closeout 被证明过早；本 phase 必须同步修复 workstream 自己的 state/roadmap/plan 漂移，不允许一边 reopen implementation、一边继续保留 completed 叙事。
- **G-05:** fail-close、repo-owned terminal outcomes、source-truth/object-store semantics、legacy Office normalization boundary 都继续保持不变；本 phase 只收口 OCR provider contract，不顺手扩 scope。

</decisions>

<specifics>
## Specific Drift Buckets

- **Architecture conflict:** `file-asset-loader-architecture.md` 已声明复杂 PDF / 复杂文档图走 `MinerU primary`, `Paddle fallback`，但 `authenticated-notice-source-architecture.md` 仍把 `ocr_required` 写成 Paddle provider 路径。
- **ADR / plan drift:** `ADR-0033` 与 `internal-notice-policy-regulation-consumption-implementation.md` 仍把 `pdf -> paddleocr_async_jobs` 当成 frozen canonical provider truth。
- **Runtime/env drift:** `raw_ingestion.py` 默认 provider/model 仍是 Paddle，且显式拒绝 primary `mineru_api`；env docs/templates 继续把 `OCR_MINERU_*` 叫做 second provider。
- **Source-specific shell drift:** `authenticated_notice_source_projections.py` 仍硬性要求 replay 环境必须是 `OCR_PROVIDER_MODE=paddleocr_async_jobs`。
- **Operator / test drift:** replay runbook、pilot runbook、doctor env、`test_process_raw_ingestion_job.py`、`test_authenticated_notice_source_projections.py` 等仍守着旧 provider-first contract。
- **Planning drift:** `shared-file-asset-loader-contract` workstream 已被标成 completed，但 provider/deployment posture 并未真正收口。

</specifics>

<canonical_refs>
## Canonical References

- `docs/architecture/file-asset-loader-architecture.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `docs/environment/README.md`
- `docs/environment/provider-and-secret-inventory.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-pilot-runbook.md`
- `docs/plans/archive/completed/shared-file-asset-loader-contract.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/shared-file-asset-loader-contract/STATE.md`
- `.planning/workstreams/shared-file-asset-loader-contract/ROADMAP.md`
- `packages/ingestion-core/src/campus_ingestion_core/file_asset_routing.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
- `env/commands/process-raw-ingestion-job.env.example`
- `.env.example`
- `tests/ingestion/test_online_ocr_routing.py`
- `tests/ingestion/test_process_raw_ingestion_job.py`
- `tests/ingestion/test_authenticated_notice_source_projections.py`
- `tests/test_doctor_env.py`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `official_web` linked/downloaded file adoption
- `authenticated_notice` `file_release`
- semantic-image multimodal enrichment
- Office-family OCR admission changes
- regulation downstream consumption

</deferred>
