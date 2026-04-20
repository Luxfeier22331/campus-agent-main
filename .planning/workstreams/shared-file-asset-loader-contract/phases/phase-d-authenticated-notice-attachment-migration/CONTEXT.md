---
phase: "D"
name: "Authenticated Notice Attachment Migration"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase D Context

**Gathered:** 2026-04-19
**Status:** Completed

<domain>
## Phase Boundary

本 phase 只负责把 `authenticated_notice` attachment path 真正接到 Phase C 已落盘的 shared file asset substrate。

它做的是 `authenticated_notice` consumer wiring：

- 让 admitted families 的 attachment extraction / OCR bridge / stored payload / artifact key semantics 不再由 source-specific module 各自维护
- 保留 notice-level source-truth、attachment relation truth、classification policy 与 restricted projection 业务语义

它不做：

- reopening shared substrate backend / provider selection
- 改写 `authenticated_notice` notice source unit
- 改写 `official_web`
- 打开 regulation downstream / query-serving / collector live run

</domain>

<decisions>
## Implementation Decisions

### Owner split
- **D-01:** `authenticated_notice_portal` 的 notice-level source-truth 与 attachment relation truth 继续留在 `authenticated_notice_*` source-specific boundary。
- **D-02:** admitted family 的 parser / normalization / OCR bytes bridge / stored extraction payload schema 已经在 Phase C 回到 shared owner；Phase D 不再允许把这些 forward truths 留在 `authenticated_notice_source_projections.py`。
- **D-03:** `authenticated_notice_source_projections.py` 可以继续持有 attachment classification、manual-review / reference-only 判定、attachment title/metadata 组装、restricted projection metadata 与 child-document materialization 语义。

### Migration posture
- **D-04:** Phase D 只做 wiring，不新建第二套 shared substrate。只有当某段逻辑被至少两个 consumer 需要时，才允许继续抽 shared helper。
- **D-05:** `.doc/.xls` 必须继续走 legacy Office shared seam；`.docx/.xlsx` 必须继续走 modern OOXML deterministic extraction；PDF/image 必须继续走 shared OCR/routing seam。
- **D-06:** source-specific module 不再持有 file-family dispatch、temp-path OCR bridge、source-private stored payload schema 这类 family-level forward truth。

### Artifact / staging semantics
- **D-07:** attachment child document 的 artifact key、processed object keys、provider/layout artifact ownership 必须优先复用 `campusrag_ingestion_support.py` 与 shared artifact key helpers，而不是让 source projection / closeout execution 各自猜字段。
- **D-08:** closeout staging 允许保留 operation-specific manifest / staging metadata / async upload orchestration；这部分只有在出现第二个 consumer 时才值得继续抽 shared helper。
- **D-09:** `no_extractable_text` / `manual_review_required` / `reference_only` / `materialized_document` 的 terminal semantics 继续保持 repo-owned，不因为 wiring 迁移而改变。

### Verification posture
- **D-10:** Phase D 的成功证据以 `authenticated_notice_source_projections`、`authenticated_notice_import`、`authenticated_notice_closeout_async` 为主；不要求扩大到其他 source channel。
- **D-11:** 迁移完成后，`authenticated_notice` 应主要表现为“source-specific classification + shared substrate consumption”，而不是“source-specific parser hub”。

### the agent's Discretion
- 是否保留少量 source-facing wrapper 函数，以便代码可读性不退化
- 是否把 closeout execution 中的 staged artifact metadata builder 留到 Phase E 再评估

</decisions>

<specifics>
## Specific Ideas

- 当前 Phase C 已经把三个最明显的 substrate owner 收口完成：
  - modern OOXML / legacy Office extraction
  - text-extractable stored payload wrapper
  - OCR bytes bridge
- 因此 Phase D 的第一目标不再是“造新 helper”，而是把 `authenticated_notice_source_projections.py` 剩余的 family-level wiring 清干净。
- `authenticated_notice_closeout_execution.py` 目前仍有一部分 staged artifact metadata / upload manifest 逻辑；它更像 closeout-specific orchestration，而不是自动进入 shared substrate 的证据。
- 这意味着 Phase D 最合理的做法是：
  - 先完成 source projection / import wiring 收口
  - 再判断 closeout execution 是否真的还剩跨-consumer shared gap

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Workstream truth
- `.planning/workstreams/shared-file-asset-loader-contract/REQUIREMENTS.md` — workstream 目标、范围、success criteria
- `.planning/workstreams/shared-file-asset-loader-contract/ROADMAP.md` — phase ordering 与当前里程碑
- `.planning/workstreams/shared-file-asset-loader-contract/STATE.md` — 当前 Phase C 已经完成的 substrate 收口事实
- `docs/plans/archive/completed/shared-file-asset-loader-contract.md` — repo-level workstream 意图与各 phase 边界

### Architecture constraints
- `docs/architecture/file-asset-loader-architecture.md` — shared file asset loader 的 canonical owner、family matrix 与 fail-close 约束
- `docs/architecture/authenticated-notice-source-architecture.md` — authenticated notice source channel owner split 与 attachment handling boundary
- `docs/architecture/authenticated-notice-source-truth-contract.md` — notice source-truth / attachment refs 的 canonical contract

### Prior phase artifacts
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-c-shared-normalization-and-extraction-substrate/CONTEXT.md` — Phase C 冻结的 implementation boundary
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-c-shared-normalization-and-extraction-substrate/PLAN.md` — Phase C substrate exit rule
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-c-shared-normalization-and-extraction-substrate/SPEC.md` — shared substrate contract scope

### Current code truth to wire
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py` — 当前 authenticated notice attachment projection owner
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py` — source import / prepared import path
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_closeout_execution.py` — closeout batch staging / attachment outcome serialization
- `packages/ingestion-core/src/campus_ingestion_core/campusrag_ingestion_support.py` — document artifact key、processed object key、stage payload 重建 shared owner
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py` — shared OCR provider bridge owner
- `packages/ingestion-core/src/campus_ingestion_core/file_asset_contract.py` — shared extraction payload / outcome contract

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `file_asset_contract.py` 已经持有 `FileAssetExtractionRecord` 与 outcome serializer/parser。
- `raw_ingestion.py::parse_online_ocr_bytes(...)` 已经成为 OCR bytes bridge 的 canonical owner。
- `campusrag_ingestion_support.py` 已经持有 `resolve_document_artifact_keys(...)`、`build_document_processed_object_keys(...)`、`serialize_document_import_stub(...)`。

### Current Consumer Truth
- `authenticated_notice_source_projections.py` 仍然是 attachment projection 的主 orchestrator，但 admitted families 的 family-level parsing truth 已经大幅收回 shared substrate。
- `authenticated_notice_import.py` 已经直接输出真实 source artifact keys，不再依赖 import-side artifact remap shim。
- `authenticated_notice_closeout_execution.py` 仍保留 staged artifact upload / metadata shape 的 closeout-specific orchestration。

### Integration Points
- source projection child document 会进入 import / closeout / verification lane，因此 artifact key、processed object key 与 provider/layout artifact shape 必须保持统一。
- closeout execution 当前仍消费 attachment outcomes 与 translated documents；Phase D 需要确认这些输入 shape 不再隐藏 source-specific family assumptions。

</code_context>

<deferred>
## Deferred Ideas

- 是否继续把 closeout-specific staged artifact upload metadata 抽成 shared async helper —— 留到出现第二个 consumer 后再判断
- `official_web` 或其他 source channel adoption —— Phase E
- backend/provider hardening 与 broader verification matrix —— Phase E

</deferred>

---

*Phase: phase-d-authenticated-notice-attachment-migration*
*Context gathered: 2026-04-19*
