# Phase 16 Context: OCR 资产分类与双渠道择优路由

## Objective

把当前 repo 的 OCR 供应商选择从单一 provider 假设，升级为“先识别资产类型，再按类型做 Paddle / MinerU / 双跑择优”的受控数据面策略。

## Why Now

- 当前 canonical raw-ingestion 仍显式拒绝 `OCR_PROVIDER_MODE=mineru_api`，说明 MinerU 已进入 repo，但仍被限定在 compare lane，尚未形成长期规则。
- 三轮本地抽样已经证明：MinerU 在部分 PDF 与复杂表格上有明显价值，但它还不适合全量替换 Paddle。
- 当前 raw-asset 元数据不足，无法可靠区分“文本主导 PDF”“简单表格图”“复杂宽表”“空间关系主导图片”这类后续必须走不同策略的资产。

## Phase Boundary

本 phase 只处理：

- raw asset typing / classification metadata
- provider-neutral OCR routing contract
- Paddle / MinerU selective compare and adjudication
- conditional MinerU canonical admission boundary

本 phase 不处理：

- query-serving 扩面
- spatial truth / map understanding
- 把 provider-specific 结构直接写进 `packages/contracts`
- 立即把 docx/xlsx 作为 canonical ingestion 默认入口

## Locked Decisions

1. repo 级 canonical chain 仍固定为 `raw asset -> provider output -> source truth -> declared projections -> canonical document artifacts -> document-units -> chunks -> index`。
2. source truth 必须保持 provider-agnostic；新增路由逻辑只能发生在 raw/provider 之间，不能让 `MinerU` / `Paddle` 形状泄漏成 downstream canonical truth。
3. 当前 Paddle canonical path 先保持不变，直到 Phase 16 的 tranche validation 明确关闭 simple-table false negative 与 routing ambiguity 风险。
4. 双 provider 消费不是默认全量双跑；只允许对高价值、歧义高、或单 provider 已知不稳定的资产触发 compare/adjudication。
5. 空间关系主导图片不进入本 phase 的 canonical OCR scope；它们既不是 MinerU 当前优势面，也不该被 OCR 文本输出冒充为空间真相。

## Local Evidence Snapshot

- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
  - canonical raw ingestion 仍直接拒绝 `mineru_api`
- `packages/ingestion-core/src/campus_ingestion_core/models.py`
  - `RawAssetRecord` 目前没有 `content_type`、维度、页数、资产类型等字段
- `apps/ingestion-worker/src/campus_ingestion_worker/register_raw_asset.py`
  - raw asset 注册目前把 `content_type` 硬编码成 `application/pdf`
- `apps/authenticated-notice-collector/src/attachment-materialization.ts`
  - 已经存在可复用的 MIME / 扩展名推断逻辑，可作为 raw asset typing 的现成起点
- `packages/ingestion-core/src/campus_ingestion_core/online_ocr_compare.py`
  - repo 已有 sidecar compare lane，但当前输出仍偏文本长度和 preview，对结构质量 / 空输出 / provider failure 的决策支持不够
- `.tmp/ocr-compare-batch/20260412*/assessment.md`
  - 已有三轮本地抽样，足够支撑 phase 规划与 tranche 化执行

## Routing Thesis

- `MinerU primary candidate`
  - text-dominant PDF
  - long structured PDF
  - wide / colored / merged-cell complex tables
- `Paddle keep / fallback`
  - simple table images
  - currently untyped images
  - assets where MinerU shows repeated empty-output risk
- `Out of canonical scope for now`
  - spatially dominant maps or diagrams
  - Office documents before raw-asset registration and downstream normalization stop assuming PDF-first truth

## Key References

- `docs/architecture/data-plane-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/environment/README.md`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `packages/ingestion-core/src/campus_ingestion_core/models.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/register_raw_asset.py`
- `apps/authenticated-notice-collector/src/attachment-materialization.ts`
- `packages/ingestion-core/src/campus_ingestion_core/online_ocr_compare.py`
- `.tmp/ocr-compare-batch/20260412/assessment.md`
- `.tmp/ocr-compare-batch/20260412-round2/assessment.md`
- `.tmp/ocr-compare-batch/20260412-round3/assessment.md`
