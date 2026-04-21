---
doc_type: phase_plan
phase: "6"
phase_name: "Institutional Regulations Target Chunk-Prep Parity"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 6 Plan

## Objective

把 `regulations/institutional_regulations` 的 target-side chunk-prep / validation 收口到与
`regulations/scoped_rules` 同级的 repo-native acceptance seam，固定 shared operator path、
artifact triplet、collection-specific validation truth，并把整个 workstream 正式恢复到
`Phase 7` 可执行状态。

## Why This Phase Exists

当前 repo 已经有：

- `institutional_regulations` chunk-prep core + worker + tests
- `scoped_rules` chunk-prep core + worker + tests
- target-side acceptance runbook
- `offline_preparation` stop point

当前 repo 还没有：

- 正式写清“parity 到底指什么，不指什么”
- institutional/scoped 双 lane 的 shared operator seam freeze
- `Phase 7` 可直接复用的 parity verification 基线

如果不先做这一步，后续 `11` 条 target rerun 会持续混淆：

- acceptance 真失败
- operator seam 不一致
- artifact contract 不一致

## Locked Inputs

- 目标 scope 固定为 `regulations/institutional_regulations` + `regulations/scoped_rules`
- stop point 固定为 `offline_preparation`
- `institutional_regulations` 继续保留 identity / semantic-owner lineage fail-close
- `scoped_rules` 继续保留 `document_nature` / `cycle_year` / `school_unit_name` fail-close
- 不重开：
  - source replay
  - promotion routing
  - target materialization scope widening
  - embedding / Qdrant / release / alias publish

## Tasks

1. 冻结 dual-lane parity contract
   - 明确双 lane 共享：
     - snapshot inputs
     - CLI shape
     - artifact triplet
   - 明确双 lane 不共享：
     - collection-specific validation counters

2. 核对并修补 repo-native parity gap
   - 对照 core functions、worker CLIs、tests、runbook、reference
   - 如果 institutional lane 缺少与 scoped_rules 同级的 operator/documentation/test seam，补齐
   - 不为了对齐而删除 institutional lane 的 lineage checks

3. 固定 operator path
   - runbook 统一把两条 lane 都写成：
     - isolated `documents.json`
     - isolated `object-store-root`
     - lane-local `output-dir`
   - 保持 optional `--document-id` 的 bounded rerun path

4. 固定 verification baseline
   - 保证以下测试与命令可作为 parity gate：
     - institutional core prep tests
     - institutional worker CLI tests
     - scoped-rule core prep tests
     - scoped-rule worker CLI tests
   - 如有需要，再补一轮 isolated snapshot smoke

5. 推进 workstream state
   - `Phase 6` 完成后，把 current slice 前移到 `Phase 7`
   - 不在本 phase 提前写 `Phase 7` 的 rerun结果

## Proposed Write Set

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_institutional_regulation_chunk_prep.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/prepare_institutional_regulation_chunks.py`
- `tests/ingestion/test_internal_notice_institutional_regulation_chunk_prep.py`
- `tests/ingestion/test_prepare_institutional_regulation_chunks_worker.py`
- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/STATE.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/ROADMAP.md`

## Constraints

- 不扩大 `11` 条 admitted target 白名单
- 不做 source-wide rematerialization
- 不把 parity 写成 “institutional == scoped_rules”
- 不把 local-only acceptance artifact 冒充为 released serving truth

## Verification Matrix

- planning verification
  - `Phase 6` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
- code/test verification
  - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep`
  - `uv run --all-packages python -m unittest tests.ingestion.test_prepare_institutional_regulation_chunks_worker`
  - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_scoped_rule_chunk_prep`
  - `uv run --all-packages python -m unittest tests.ingestion.test_prepare_scoped_rule_chunks_worker`
- operator verification
  - runbook 明确双 lane 的 shared input/output seam
  - 双 lane 都导出：
    - `chunk-prep-manifest.json`
    - `validation-summary.json`
    - `document-reports.jsonl`
- scope verification
  - 没有引入 embedding、Qdrant、release 或 alias publish

## Exit Rule

Phase 6 完成后，repo 应达到：

- `institutional_regulations` 与 `scoped_rules` 的 target-side acceptance seam 已正式对齐
- collection-specific validation truth 仍显式保留
- `Phase 7` 可以直接做 `11` 条 target 的 full rerun，而不必再争论 operator parity
