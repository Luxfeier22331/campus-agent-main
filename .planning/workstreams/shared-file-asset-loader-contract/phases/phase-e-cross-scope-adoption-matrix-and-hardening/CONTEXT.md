---
phase: "E"
name: "Cross-Scope Adoption Matrix And Hardening"
created: 2026-04-19
updated: 2026-04-19
status: planned
---

# Phase E Context

**Gathered:** 2026-04-19
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 固化 shared file asset substrate 在 repo 内的 adoption matrix
- 收口 Phase A-D 留下的 docs / dependency / verification drift
- 明确哪些 scope 继续 deferred，哪些 follow-up 必须分流到别的 workstream

它不负责：

- reopening backend / provider selection
- 再次回到 `authenticated_notice` consumer wiring 做 parser owner 收口
- 打开 `official_web` linked file adoption
- 打开 `file_release`、regulation downstream、query-serving 或 collector live run

</domain>

<decisions>
## Implementation Decisions

### Adoption matrix
- **E-01:** Phase E 必须把 repo 内 file-like asset adoption 明确分成三类：
  - 已接入 shared substrate
  - 明确 deferred
  - 不属于本 workstream / 应分流到其他 workstream
- **E-02:** 当前已接入 shared substrate 的 canonical slices 至少包括：
  - `raw_ingestion.py` / `register_raw_asset.py` 对 `file_asset_routing.py` 的 typed routing 消费
  - `apps/ingestion-worker` legacy Office normalization shell 对 `file_asset_legacy_office.py` 的 thin delegation
  - `authenticated_notice_source_projections.py` 对 `file_asset_text_extractable.py`、`parse_online_ocr_bytes(...)`、shared payload contract 的消费
  - `authenticated_notice_import.py` / `authenticated_notice_source_truth_replay.py` / `authenticated_notice_closeout_execution.py` 对 shared artifact / payload helpers 的消费
- **E-03:** 当前必须明确 deferred 的 canonical slices 至少包括：
  - `official_web` page-linked / downloaded file adoption
  - `authenticated_notice` `file_release` surface
  - `internal_notice -> regulations/*` downstream consumption
  - semantic image multimodal enrichment

### Hardening posture
- **E-04:** Phase E 必须显式区分：
  - family tranche truth
  - 当前具体 source path 的 admitted extension truth
  当前代码真相是 `internal_notice` attachment-consumption default lane 只 admitted `docx/xls/xlsx`，而 `.doc` 仍是 explicit fail-close gap。
- **E-05:** `packages/ingestion-core/pyproject.toml` 中残留的 `xlrd` dependency 必须进入 hardening audit；如果 code truth 已不再需要它，就应作为候选清理项，而不是继续靠历史 dependency 漂着。
- **E-06:** `raw_asset_typing.py` 与 `online_ocr_routing.py` 当前只剩 compatibility shim。Phase E 需要决定：
  - 继续保留并文档化它们的兼容性定位
  - 或在没有剩余 import 约束时删除它们
- **E-07:** 不为了 Phase E 人为抽 shared helper。只有当 docs / dependency / verification drift 真正指向 shared contract 漏洞时，才允许动 shared substrate。

### Documentation and verification
- **E-08:** 如果 operator contract 没变，就不强行扩写 runbook；优先更新 architecture / plan / reference docs 以消除 code truth drift。
- **E-09:** Phase E 必须给出 repo-owned verification matrix，至少覆盖：
  - shared substrate
  - authenticated notice source projections
  - authenticated notice import / export worker
  - authenticated notice closeout async
  - raw ingestion OCR routing

</decisions>

<specifics>
## Specific Ideas

- 当前最明显的 hardening drift 有三个：
  - `docs/architecture/system/file-asset-loader-architecture.md` 与 workstream phase wording 容易让人误读成 `.doc` 已在 `authenticated_notice` lane 内 admitted；而当前 config README 明确 `.doc` 仍 fail-close
  - `packages/ingestion-core/pyproject.toml` 仍带 `xlrd>=2.0.1`，但 shared substrate 代码真相已切到 LibreOffice normalization + OOXML parse
  - compatibility shim 还在，但它们已经不是 forward owner；如果继续保留，需要在 docs / matrix 中写清原因
- 当前未发现必须立即继续抽 shared helper 的第二个 consumer gap；Phase E 更像 matrix / drift closeout，而不是 reopen implementation substrate

</specifics>

<canonical_refs>
## Canonical References

### Workstream truth
- `.planning/workstreams/shared-file-asset-loader-contract/REQUIREMENTS.md`
- `.planning/workstreams/shared-file-asset-loader-contract/ROADMAP.md`
- `.planning/workstreams/shared-file-asset-loader-contract/STATE.md`
- `docs/plans/archive/completed/shared-file-asset-loader-contract.md`

### Architecture and source boundaries
- `docs/architecture/system/file-asset-loader-architecture.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`

### Code truth to audit
- `packages/ingestion-core/src/campus_ingestion_core/file_asset_contract.py`
- `packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py`
- `packages/ingestion-core/src/campus_ingestion_core/file_asset_ooxml.py`
- `packages/ingestion-core/src/campus_ingestion_core/file_asset_text_extractable.py`
- `packages/ingestion-core/src/campus_ingestion_core/file_asset_routing.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_asset_typing.py`
- `packages/ingestion-core/src/campus_ingestion_core/online_ocr_routing.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_closeout_execution.py`
- `packages/ingestion-core/pyproject.toml`
- `configs/ingestion/campus_notices/internal_notice/README.md`
- `configs/ingestion/campus_notices/internal_notice/source-projections.v1.json`

### External official refs checked for this phase
- AWS S3 object key semantics:
  - https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html
- MinerU official docs:
  - https://mineru.net/doc/docs/index_en/
- PaddleOCR PP-StructureV3 official docs:
  - https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PP-StructureV3.html

</canonical_refs>

<code_context>
## Existing Code Insights

### Landed substrate truth
- `file_asset_text_extractable.py` 已把 text-extractable family dispatch 收回 shared owner
- `authenticated_notice_source_projections.py` 已不再持有 `.docx/.xlsx/.xls` parser dispatch truth
- `authenticated_notice_closeout_execution.py` 的 replay staged raw-asset `source_artifact_keys` 已对齐 bundle-import lane 的 canonical relative artifact paths

### Residual drift
- `internal_notice` config README 仍明确 `.doc` 是 fail-close gap，这与“legacy Office tranche 包含 `.doc/.xls`”不是同一层 truth
- `xlrd` 仍残留在 `packages/ingestion-core/pyproject.toml`
- compatibility shim 仍存在，但 canonical owner 已转移到 `file_asset_routing.py`

</code_context>

<deferred>
## Deferred Ideas

- `official_web` file adoption
- `authenticated_notice` `file_release`
- semantic image multimodal lane
- provider / deployment reopen
- broader cross-source execution after adoption matrix is frozen

</deferred>

---

*Phase: phase-e-cross-scope-adoption-matrix-and-hardening*
*Context gathered: 2026-04-19*
