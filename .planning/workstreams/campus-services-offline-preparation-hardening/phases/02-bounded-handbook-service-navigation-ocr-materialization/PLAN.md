---
doc_type: phase_plan
phase: "02"
phase_name: "Bounded Handbook Service Navigation Hybrid Materialization"
status: planned
created: 2026-04-20
updated: 2026-04-20
---

# Phase 02 Plan

## Objective

为 handbook-derived `中央民族大学学生公寓管理工作流程`
实现 `OCR provenance + constrained multimodal body/edge recovery`
的 bounded hybrid materialization，
并让 raw ingestion 与 provider-response replay 都能稳定生成：

- `flow-graph.json`
- `canonical.md`
- `document-units.jsonl`

## Why This Phase Exists

当前 admission 已经完成，但 repo 还缺少真正可执行的 hybrid materialization lane：

- 现有 cleanup path 只适合 title/body text 文档，不适合 image-heavy flowchart
- replay rebuild 没有真实 raw PDF object key，无法生成同一页段的 page PNG
- 如果现在直接执行 Phase 03 验证，只会继续验证 title-only degradation，而不是解决它

## Locked Inputs

- target projection 固定为 `handbook_navigation_service_catalog`
- selector 固定为：
  - `source_title=中央民族大学公寓及公费医疗管理规定`
  - `source_handbook_section=中央民族大学公寓及公费医疗管理规定`
  - `source_page_start=252`
  - `source_page_end=255`
- target title 固定为 `中央民族大学学生公寓管理工作流程`
- `service_catalog` 继续保持 `offline_preparation`
- OCR `provider-response.jsonl` 与 `layout-elements.jsonl` 继续保留为 provenance
- 不修改 handbook 其他 projection
- 不打开 query-serving
- 不扩到 curriculum、auth、regulation、retrieval rollout

## Decisions To Freeze

1. Phase 2 的 canonical owner 继续留在 `packages/ingestion-core`，
   以 `build_handbook_projection_import_documents(...)` 为汇合入口。
2. hybrid lane 必须是 projection-local dispatch，
   不能变成对所有 handbook projection 默认开启的视觉解析路径。
3. hybrid lane 的视觉输入必须来自真实 raw PDF 的 declared-page PNG，
   不能直接复用 provider-response 文本，也不引入新的 PDF text extraction contract。
4. target-local multimodal artifact 固定新增为：
   - `flow-graph.json`
5. `flow-graph.json` 是 `canonical.md` 与 `document-units.jsonl` 的直接上游，
   但它不是新的 source-truth artifact。
6. 如果 raw object 缺失、页渲染失败、schema 解析失败、graph 无有效正文或只剩标题，
   整个 projection 必须 fail-close。

## Execution Slices

### Slice 1: Freeze Exact Projection Dispatch

- 在 `handbook_source_projections.py` 引入 projection-local dispatch：
  - 仅 `projection_name=handbook_navigation_service_catalog` 走 hybrid lane
- 执行前再次校验：
  - `target_collection=service_catalog`
  - `attachment_role=service_navigation_document`
  - `source_page_start/source_page_end=252/255`
- 非目标 projection 继续走现有 cleanup/materialization 路径

Reason:

- 这保证 Phase 2 只是收口 admitted slice，
  而不是悄悄为 handbook 派生 projection 新增通用视觉查询能力。

### Slice 2: Add Real Raw PDF Resolution For Raw And Replay

- raw ingestion 路径继续复用现有 `raw_asset_record.object_key`
- replay rebuild 路径必须把真实 raw asset record 继续传入 hybrid helper，
  不能再只依赖 synthetic `object_key=provider_response_key`
- 若 replay 无法解析真实 raw object key：
  - 直接 fail-close
  - error message 必须明确指出是 raw asset resolution 缺失，而不是 flow extraction 失败

Reason:

- raw/replay 必须在同一 source-truth 上得到相同 materialization 结果。

### Slice 3: Render Only Declared Pages To PNG

- 新增一个 bounded page rendering helper
- 输入：
  - raw PDF bytes
  - declared page range `252-255`
- 输出：
  - page 252-255 对应的 ordered PNG bytes
- 实现依赖按 `pymupdf` 冻结
- 页码语义继续保持 handbook source-truth 的 1-based 闭区间；
  底层库只允许做内部 index 换算

Reason:

- Phase 2 需要的是视觉输入的稳定复现，不是 PDF 裁剪文件本身。

### Slice 4: Execute Strict Hybrid Extraction

- 新增 projection-local multimodal executor/helper，复用现有 prompt runtime
- 输入只允许包含：
  - ordered page PNGs
  - target title
  - source page mapping
- 输出 schema 固定为 bounded flow graph，至少包含：
  - `document_title`
  - `page_findings`
  - `flow_heading`
  - `steps`
  - `step_id`
  - `step_text`
  - `next_step_ids`
  - `manual_review_notes`
  - `global_manual_review_required`
- schema 必须保持 strict，避免开放式 metadata bag

Reason:

- 当前 phase 的目标是稳定恢复流程节点与边，不是让模型自由解释制度。

### Slice 5: Materialize Target-Local Artifacts

- 先把 strict extraction 结果落成 `flow-graph.json`
- 再从 `flow-graph.json` 生成：
  - `canonical.md`
  - `document-units.jsonl`
- canonical/document units 必须继续带完整 lineage：
  - `projection_name`
  - `derived_from`
  - `derived_from_document_id`
  - `derived_from_raw_asset_id`
  - `derived_from_raw_version_id`
  - `migration_source_provider_response_key`
  - `source_page_start`
  - `source_page_end`
- OCR provider artifacts 继续出现在 processed object keys 中

Reason:

- 没有独立 `flow-graph.json`，后续就无法区分：
  - multimodal graph extraction 是否成功
  - canonical/document-unit renderer 是否成功

### Slice 6: Fail-Close On Title-Only Or Empty Graph

- 以下情况一律视为 materialization failure：
  - `flow-graph.json` 没有任何 body-bearing steps
  - 只有标题、页码、泛化总结，没有稳定 step graph
  - `next_step_ids` 存在悬空或越页引用
  - 页面数量、顺序或 page mapping 与 selector 不一致
- 失败后不得静默落成 title-only `canonical.md` / `document-units.jsonl`

Reason:

- 当前 blocker 正是“静默成功但正文缺失”。

### Slice 7: Add Targeted Tests

- 为 raw ingestion 路径补测试：
  - 只对 `handbook_navigation_service_catalog` 触发 hybrid lane
  - 只渲染 `252-255` 页
  - 成功时写出 `flow-graph.json`
- 为 replay rebuild 路径补测试：
  - 使用真实 raw asset record 进入 hybrid lane
  - 缺失 raw object key 时 fail-close
- 为 materialization 结果补测试：
  - title-only graph fail-close
  - step graph -> canonical/document units 的 lineage 与 processed keys 正确
- 测试只覆盖当前 bounded slice，不增加 whole-handbook 泛化 case

## Proposed Write Set

- `packages/ingestion-core/src/campus_ingestion_core/handbook_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_service_navigation_hybrid_materialization.py`
- `packages/ingestion-core/pyproject.toml`
- `tests/ingestion/test_provider_result_replay_rebuild.py`
- `tests/ingestion/test_rebuild_local_data.py`
- `tests/ingestion/test_handbook_service_navigation_hybrid_materialization.py`

## Verification Matrix

- planning verification
  - `Phase 02` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向本 plan
  - `ROADMAP.md` 记录 `Phase 2` 已有 1 个 plan
- implementation verification
  - raw ingestion 只对目标 projection 触发 hybrid lane
  - replay rebuild 能解析真实 raw asset 并得到同样 page range
  - `flow-graph.json`、`canonical.md`、`document-units.jsonl` 三者共同落盘
  - title-only / empty graph fail-close
- command verification
  - `uv run --all-packages python -m unittest tests.ingestion.test_provider_result_replay_rebuild`
  - `uv run --all-packages python -m unittest tests.ingestion.test_rebuild_local_data`
  - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_service_navigation_hybrid_materialization`

## Exit Rule

Phase 02 完成时，repo 应达到：

- `handbook_navigation_service_catalog` 已有正式的 bounded hybrid materialization lane
- raw ingestion 与 replay rebuild 对这条 slice 共享同一实现与同一 fail-close 口径
- target-local artifacts 不再退化为 title-only
- 这条线仍停留在 `service_catalog` 的 `offline_preparation`，
  不与 query-serving、auth 或 regulation 主线耦合
