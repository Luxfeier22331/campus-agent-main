# 16-04 Summary: tranche validation 收口与 canonical-scope 决策关闭

## Outcome

Phase 16 已完成 closeout。当前 repo 不再只是“有一套 OCR 路由矩阵”，而是已经把 tranche evidence 真正落到了 canonical ingestion 行为上：

- `campus-ingestion-compare-online-ocr` 现在会输出 `asset_typing` 与 `routing_recommendation`
- `process_raw_ingestion_job` 在 `source_truth_only` 下遇到 `generic_image` 且配置了 `OCR_MINERU_*` 时，会双跑 Paddle + MinerU，再按证据精化 raw-asset type truth
- refined `simple_table_image` 会保持 Paddle primary
- refined `complex_table_image` 会提升到 `MinerU primary`
- refined `spatial_image` 会 fail-close deferred，而不是冒充 canonical OCR 入口
- dual-run 结果会落盘 `ocr-routing-decision.json`，raw-asset registry 也会回写 refined `asset_subkind`

## Closed Decision

Phase 16 的 canonical-scope 结论现已冻结为：

- `pdf`
  - `MinerU primary -> Paddle fallback`
- `simple_table_image`
  - `Paddle primary`
- `complex_table_image`
  - `MinerU primary`
- `generic_image`
  - 双跑后再决定；若仍无足够结构证据，则保持 Paddle safe default
- `spatial_image`
  - deferred / fail-close
- `office_document`
  - deferred

这不是把 MinerU 提升为全局 canonical provider。

## Key Changes

- `packages/ingestion-core/src/campus_ingestion_core/online_ocr_evidence.py`
  - 抽出 provider plain-text extraction、summary、structure signals 与 adjudication 共享逻辑
- `packages/ingestion-core/src/campus_ingestion_core/raw_asset_typing.py`
  - 新增 compare-evidence 驱动的 image subkind refinement
- `packages/ingestion-core/src/campus_ingestion_core/online_ocr_routing.py`
  - 新增 dual-run 后的 adjudicated image routing 选择
- `packages/ingestion-core/src/campus_ingestion_core/online_ocr_compare.py`
  - compare summary 现已输出 `asset_typing` 与 `routing_recommendation`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
  - `generic_image` source-truth-only 现已支持 Paddle + MinerU dual-run、refined routing、registry 回写与 `ocr-routing-decision.json`

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_online_ocr_compare \
  tests.ingestion.test_compare_online_ocr_worker \
  tests.ingestion.test_online_ocr_routing \
  tests.ingestion.test_process_raw_ingestion_job
```

Result:

- `Ran 44 tests`
- `OK`

## Remaining Boundary

- `OCR_PROVIDER_MODE=mineru_api` 仍不得作为 primary canonical raw-ingestion provider
- 空间关系主导图片仍不进入 canonical OCR truth
- Office 文档虽然是 MinerU 的潜在优势面，但当前 repo 仍保持 deferred，等待后续 phase 专门收口
