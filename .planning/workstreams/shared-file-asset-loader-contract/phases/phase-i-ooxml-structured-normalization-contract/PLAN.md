---
doc_type: phase_plan
phase: "I"
phase_name: "OOXML Structured Normalization Contract"
status: active
created: 2026-04-20
updated: 2026-04-20
---

# Phase I Plan

## Objective

为 `.docx/.xlsx` 落 repo-owned post-extraction structured normalization contract，并让 shared loader 的至少一条真实消费路径从扁平 `text_blocks` 迁到 normalized structural artifact。

## Why This Phase Exists

`Phase H` 已经证明：

- legacy Office conversion runtime 正常
- modern OOXML deterministic extraction 正常
- 真实对象存储样本可完成 `.doc/.xls -> .docx/.xlsx -> OOXML`

但 repo 仍缺：

- OOXML downstream structural truth
- generic `layout_elements_bytes` for OOXML
- consumer-side migration from `text_blocks` to structured artifact

如果不补这一步，shared file asset loader 会继续停在“能提取，但语义还得下游自己猜”的半收口状态。

## Locked Decisions

- OOXML structured normalization 位于 deterministic extraction 之后，不回写 source truth。
- `layout_elements_bytes` 作为 OOXML normalized structural artifact 的 canonical downstream seam。
- `text_blocks` 暂时保留为 compatibility / diagnostics，不在本 phase 直接删除。
- `authenticated_notice_source_projections.py` 作为首个 consumer migration target。
- 本 phase 不重开 PDF / OCR / legacy Office runtime / collection-specific cleanup / downstream regulation materialization。

## Execution Slices

### Slice 1: Freeze Shared OOXML Structured Contract

- 明确 OOXML normalized artifact 复用 `layout_elements_bytes`，不新造平行 artifact lane。
- 在 shared contract 层补充 structured-normalization truth：
  - outcome shape
  - artifact refs
  - provenance semantics
  - extraction vs normalization separation
- 决定最小 row schema：
  - shared fields
  - `docx` row fields
  - `xlsx` row fields
  - deterministic forward-fill flags

### Slice 2: Implement DOCX Structured Normalizer

- 在 `packages/ingestion-core` 为 `docx` 新增 OOXML structured normalization entrypoint。
- 产出至少以下结构语义：
  - `title`
  - `heading`
  - `paragraph`
  - `list_item`
  - `table`
- 表格行保留 `table_cells` / header / row-count / column-count semantics。
- heading/list 判断必须 deterministic；歧义时降级为 `paragraph`，不要猜。

### Slice 3: Implement XLSX Structured Normalizer

- 在 `packages/ingestion-core` 为 `xlsx` 新增 workbook/sheet-aware structured normalizer。
- 至少保留：
  - `sheet_name`
  - worksheet row order
  - cell displayed value
  - formula
  - merged/continuation semantics
  - deterministic forward-fill flags
- 禁止把整份 workbook 再压平成一段长文本当 canonical truth。

### Slice 4: Integrate Shared Consumer Path

- 更新 `authenticated_notice_source_projections.py`：
  - `text_extractable` attachment 如存在 OOXML structured rows，优先从 structured rows 构造：
    - canonical markdown
    - document units
    - `layout_elements_bytes`
- 保持兼容：
  - 当前 provider payload / extraction payload 不立即删除
  - 在 structured artifact 缺失时仍可回到旧路径
- 这一步的目标不是长期双路径，而是让 migration 可验证、可分层推进。

### Slice 5: Verification And Evidence

- 单元测试覆盖：
  - `docx` heading / paragraph / table normalization
  - `xlsx` sheet / row / cell / formula / forward-fill normalization
  - `authenticated_notice` consumer 优先读取 OOXML structured artifact
- 真实样本验证覆盖：
  - 直接 `.docx/.xlsx`
  - legacy Office conversion 后的 `.docx/.xlsx`
- evidence 必须能回答两个问题：
  - source-faithful extraction 是否仍保持
  - downstream structural quality 是否明显提升

## Proposed Write Set

- `packages/ingestion-core/src/campus_ingestion_core/file_asset_contract.py`
- `packages/ingestion-core/src/campus_ingestion_core/file_asset_ooxml.py`
- new shared OOXML normalization helper/module under `packages/ingestion-core/src/campus_ingestion_core/`
- `packages/ingestion-core/src/campus_ingestion_core/file_asset_text_extractable.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
- targeted tests under `tests/ingestion/`
- minimal planning/state sync for this phase

## Verification

- `uv run --all-packages python -m unittest tests.ingestion.test_file_asset_substrate`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker`
- real-asset OOXML recheck using the existing `.tmp/phase-h-libreoffice-runtime-productization-recheck/` sample set

## Exit Rule

Phase I completes only when:

- shared OOXML structured normalization contract is frozen
- `.docx/.xlsx` have repo-owned normalized structural artifacts
- at least one real shared consumer path uses those artifacts preferentially
- real-sample verification proves improved downstream semantics without regressing source-faithful extraction
