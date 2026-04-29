---
doc_type: phase_plan
phase: "03"
phase_name: "Service Navigation Targeted Verification And Rebuild Integration"
status: planned
created: 2026-04-20
updated: 2026-04-20
---

# Phase 03 Plan

## Objective

把 `Phase 02` 已实现的 bounded handbook service navigation hybrid lane
收口为正式可验证的 workstream truth，
重点覆盖：

- selector 不越界
- raw / replay convergence
- rebuild integration closeout
- planning truth catch-up

## Why This Phase Exists

`Phase 02` 已完成“能力建设”，
但当前 workstream 还没有正式证明：

- 这条 lane 不会误扩大到 handbook 其他 projection
- rebuild / replay 已在正式口径上收口
- 当前可恢复点已经从实现转到 closeout

如果现在直接跳到 `Phase 04`，
会把 verification 与 integration 证据留在代码里而不是 planning truth 里。

## Locked Scope

- target projection 继续固定为 `handbook_navigation_service_catalog`
- source selector 继续固定为 `252-255` 页
- `service_catalog` 继续保持 `offline_preparation`
- 不新增 live OCR probe、query-serving、curriculum、auth、regulation 或 retrieval rollout 任务
- 不把当前 helper 再提升成 repo-wide multimodal parser 或通用 flow extractor

## Decisions To Freeze

1. `Phase 03` 默认优先补 verification evidence，而不是继续扩能力。
2. “通过 strict schema” 不能单独算 closeout；必须继续验证 fail-close semantic gates。
3. replay 的真实 raw asset 要求只允许命中 bounded hybrid projection，不能外溢成 handbook replay 的通用前置条件。
4. rebuild integration closeout 应以 targeted tests 和 planning summary 为主，不引入 live external execution 作为本 phase 的必需门槛。

## Execution Slices

### Slice 1: Freeze Verification Matrix

- 明确 `Phase 03` 必须验证的四类问题：
  - selector non-expansion
  - fail-close semantics
  - raw / replay convergence
  - rebuild cleanup / processed-key integration
- 把这些问题与现有测试一一对应，避免重复发明宽泛 smoke

Reason:

- 这能保证本 phase 是“验证收口”，而不是再开一轮模糊 QA。

### Slice 2: Verify Selector Non-expansion

- 确认只有以下组合进入 hybrid lane：
  - `projection_name=handbook_navigation_service_catalog`
  - `target_collection=service_catalog`
  - `attachment_role=service_navigation_document`
  - `source_page_start=252`
  - `source_page_end=255`
- 若现有测试不足，补 targeted regression test

Reason:

- 当前最大风险已从“缺少能力”转成“能力误扩范围”。

### Slice 3: Verify Fail-close Semantics

- 确认以下情况持续失败，不再静默落盘：
  - title-only / no body-bearing steps
  - page mapping mismatch
  - dangling `next_step_ids`
  - replay 缺失真实 raw asset record
- 如果现有测试只覆盖其中一部分，补最小定向 case

Reason:

- 这是 bounded extraction lane 的真正质量闸门。

### Slice 4: Verify Raw / Replay Convergence

- 针对 raw ingestion 与 provider-response replay：
  - 确认两条路径都走同一个 projection-local owner seam
  - 确认 hybrid lane 使用的是真实 raw PDF object key，而不是 provider-response synthetic key
  - 确认非目标 projection 仍保持原有 source-truth rebuild 语义

Reason:

- 这是避免 future rebuild 出现“raw 成功、replay 漂移”的核心证据。

### Slice 5: Verify Rebuild Cleanup Integration

- 针对 `rebuild_local_data`：
  - 确认 declared projection cleanup 继续覆盖：
    - `canonical.md`
    - `document-units.jsonl`
    - `flow-graph.json`
  - 确认 processed-key accounting 不回退到旧的 two-artifact 假设

Reason:

- `flow-graph.json` 已成为正式 target-local artifact，cleanup 和 rebuild 不能假装它不存在。

### Slice 6: Write Closeout Summary Inputs

- 在本 phase 结束时沉淀：
  - 通过的 targeted command list
  - 对应验证面
  - 剩余 gap 是否只剩 planning closeout / follow-up routing

Reason:

- 这为 `Phase 04` 提供最小、稳定、可引用的 closeout 输入。

## Proposed Write Set

- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/03-service-navigation-targeted-verification-and-rebuild-integra/PLAN.md`
- `tests/ingestion/test_handbook_service_navigation_hybrid_materialization.py`
- `tests/ingestion/test_provider_result_replay_rebuild.py`
- `tests/ingestion/test_rebuild_local_data.py`
- 如确有缺口，再最小修改：
  - `packages/ingestion-core/src/campus_ingestion_core/handbook_source_projections.py`
  - `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
  - `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`

## Verification Matrix

- planning verification
  - `Phase 02` 有正式 `SUMMARY.md`
  - `Phase 03` 目录有 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 当前计划切到 `Phase 03`
  - `ROADMAP.md` 反映 `Phase 02 completed / Phase 03 planned`
- implementation verification
  - hybrid lane 仍只命中 exact bounded selector
  - fail-close gates 继续有效
  - replay 只在 hybrid projection 分支要求真实 raw asset
  - rebuild cleanup / processed keys 已纳入 `flow-graph.json`
- command verification
  - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_service_navigation_hybrid_materialization`
  - `uv run --all-packages python -m unittest tests.ingestion.test_provider_result_replay_rebuild`
  - `uv run --all-packages python -m unittest tests.ingestion.test_rebuild_local_data`

## Exit Rule

Phase 03 完成时，repo 应达到：

- `Phase 02` 的 bounded hybrid lane 已被正式验证为：
  - 不越界
  - 会 fail-close
  - raw / replay 一致
  - rebuild integration 已收口
- workstream 当前恢复点不再停在实现层，而是进入 `Phase 04` planning closeout
