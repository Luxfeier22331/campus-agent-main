# 16-03 Summary: 条件式 canonical routing 与 fallback boundary

## Outcome

Phase 16 的第三步已经落地：repo 现在不再只有“Paddle primary”这一条 canonical raw-ingestion 路径，而是有了受 typed asset metadata 驱动的条件式 routing boundary。

这一步完成了四件事：

- `process_raw_ingestion_job` 现在支持主 `OCR_*` Paddle lane 之外的可选 `OCR_MINERU_*` 第二 provider
- `source_truth_only` 路径现已能对 typed PDF 执行 `MinerU primary -> Paddle fallback`
- MinerU 胜出时，会把 canonicalized `provider-response.jsonl` 与 `layout-elements.jsonl` 正常落入 source truth，同时额外保留 `provider-response-raw.zip` provenance sidecar
- canonical raw-asset parsing 不再硬编码 `parse_pdf()`；非 PDF typed asset 现在会走 `parse_file()`

## Key Changes

- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
  - `OnlineOcrSettings` 新增 prefix-aware env loading，支持 `OCR_MINERU_*`
  - 恢复并保留 `mineru_api` client/support helpers
  - `process_raw_ingestion_job` 新增 provider map 注入能力
  - `source_truth_only` 路径新增 typed routing、MinerU adaptation、Paddle fallback 与 raw zip sidecar 持久化
  - `_parse_registered_raw_asset()` 现已按 asset/file type 选择 `parse_pdf()` 或 `parse_file()`
- `packages/ingestion-core/src/campus_ingestion_core/online_ocr_routing.py`
  - 路由矩阵与 MinerU archive -> canonical provider payload adapter 进入可执行路径
- `tests/ingestion/test_online_ocr_routing.py`
  - 固化 typed routing / archive adaptation 回归测试
- `tests/ingestion/test_process_raw_ingestion_job.py`
  - 新增 source-truth-only MinerU primary、Paddle fallback 与 raw zip sidecar 回归测试
- `env/commands/process-raw-ingestion-job.env.example`
  - 补 `OCR_MINERU_*` 命令级 override 模板
- `docs/environment/README.md`
  - 明确 primary `OCR_*` 与 optional `OCR_MINERU_*` 的 ownership / boundary
- `docs/environment/provider-and-secret-inventory.md`
  - 更新 OCR provider inventory，说明 `OCR_MINERU_*` 当前只进入 source-truth-only 条件式 canonical 路由
- `apps/ingestion-worker/README.md`
  - 更新 operator-facing raw-ingestion 行为说明

## Verification

Automated:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_online_ocr_compare \
  tests.ingestion.test_compare_online_ocr_worker \
  tests.ingestion.test_online_ocr_routing \
  tests.ingestion.test_process_raw_ingestion_job
```

Result:

- `Ran 38 tests`
- `OK`

## Remaining Gap

- 当前 conditional canonical routing 真正接入的是 `source_truth_only` canonical lane；normalized split-manifest path 仍保持当前 primary Paddle 行为，不在这一步引入第二 provider path
- MinerU 仍未通过 simple-table false-negative 风险关口；因此当前 repo 仍不得把它表述成全局 canonical OCR provider
- live tranche rerun 与 explicit canonical-scope decision 仍待 `16-04`

## Next

- 执行 `16-04`
- 用 tranche 抽样与 live rerun 关闭 canonical-scope / promotion-threshold 问题，而不是继续扩张 provider 默认入口
