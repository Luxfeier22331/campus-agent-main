---
doc_type: phase_plan
phase: "7"
phase_name: "Eleven-Target Acceptance Rerun And Gap Closure"
status: completed
created: 2026-04-21
updated: 2026-04-24
---

# Phase 7 Plan

## Objective

对当前 `11` 条 admitted regulation target 执行 full local-only acceptance rerun，
把 institutional/scoped 两条 lane 的真实 fail-close gap 收口到 zero-fail 或 bounded residual list，
为 `Phase 8` 的 evidence freeze 提供最终输入。

## Why This Phase Exists

当前 repo 已经有：

- bounded `11` 条 target inventory
- dual-lane chunk-prep worker
- machine-readable acceptance artifacts

当前 repo 还没有：

- 一次完整的 `11` 条 target rerun证据
- target-side residual gap 的最终 closure 列表
- 进入 evidence freeze 之前的最终通过口径

## Locked Inputs

- rerun scope 固定为当前 `11` 条 admitted target
- blocked / duplicate / out-of-scope items 不进入 rerun
- acceptance gate 固定采用 runbook 当前指标
- stop point 仍固定在 `offline_preparation`

## Tasks

1. 准备 isolated rerun snapshot
   - 确认 `documents.json` 与 object-store root 对应当前 target snapshot
   - 分 lane 准备 institutional / scoped_rules output dir

2. 执行 full local-only rerun
   - institutional lane 跑全量 target-side acceptance
   - scoped-rules lane 跑全量 target-side acceptance
   - 保留每次 rerun 的 artifact triplet

3. 汇总 residual gaps
   - 从 `validation-summary.json` 抽取 lane-level counters
   - 从 `document-reports.jsonl` 抽取 per-document failure class
   - 把 gap 归类为：
     - title/contextualization
     - identity/projection metadata
     - semantic-owner lineage
     - wrapper/front matter leakage

4. 做 bounded gap closure
   - 只修正 target-side chunk-prep / metadata / artifact问题
   - 如需代码修复，限定在 current admitted target closeout 所需最小范围
   - 修完后 rerun 直到：
     - zero-fail
     - 或得到显式 residual list

5. 形成 rerun summary
   - 固定记录：
     - total targets rerun
     - lane-level pass/fail
     - remaining residual issues if any
   - 供 `Phase 8` 直接冻结

## Proposed Write Set

- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_institutional_regulation_chunk_prep.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_scoped_rule_chunk_prep.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/prepare_institutional_regulation_chunks.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/prepare_scoped_rule_chunks.py`
- `tests/ingestion/test_internal_notice_institutional_regulation_chunk_prep.py`
- `tests/ingestion/test_internal_notice_scoped_rule_chunk_prep.py`
- `tests/ingestion/test_prepare_institutional_regulation_chunks_worker.py`
- `tests/ingestion/test_prepare_scoped_rule_chunks_worker.py`
- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/STATE.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/ROADMAP.md`

## Constraints

- 不引入第 `12` 条 target
- 不把 auth-blocked frontier 混进 rerun
- 不因为 rerun 失败而回退到 source-side replay / OCR 范围扩张
- 不把 rerun artifact 当成 published serving evidence

## Verification Matrix

- rerun verification
  - institutional lane `validation-summary.json.passed = true`
  - scoped-rules lane `validation-summary.json.passed = true`
  - `document-reports.jsonl` 无遗漏 target
- targeted test verification
  - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep`
  - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_scoped_rule_chunk_prep`
  - `uv run --all-packages python -m unittest tests.ingestion.test_prepare_institutional_regulation_chunks_worker`
  - `uv run --all-packages python -m unittest tests.ingestion.test_prepare_scoped_rule_chunks_worker`
- scope verification
  - rerun白名单仍是当前 `11` 条
  - 没有新增 embedding / Qdrant / release 行为

## Exit Rule

Phase 7 完成后，repo 应达到：

- 当前 `11` 条 admitted target 已完成一次 full local-only acceptance rerun
- institutional/scoped 两条 lane 的 residual gap 已被关闭或显式列清
- `Phase 8` 可以直接冻结 evidence，而不需要再补充 rerun 解释
