# Quick Task 260411-u0t Summary

## Outcome

- scoped-rule downstream materialization 已补齐。
- 重复内容现在会按 promotion 阶段的 duplicate identity 聚合，不会在 `regulations/scoped_rules` 重复生成多份文档。
- `internal_notice` README 与 project state 已同步为“source-side manifest 仍只做 read-only 分类，downstream worker 负责 scoped-rules 导入”。

## What Changed

- 新增并验证：
  - `packages/ingestion-core/src/campus_ingestion_core/internal_notice_scoped_rule_materialization.py`
  - `apps/ingestion-worker/src/campus_ingestion_worker/materialize_internal_notice_scoped_rules.py`
  - `tests/ingestion/test_internal_notice_scoped_rule_materialization.py`
  - `tests/ingestion/test_materialize_internal_notice_scoped_rules_worker.py`
- 同步更新：
  - `configs/ingestion/campus_notices/internal_notice/README.md`
  - `.planning/STATE.md`

## Remaining Gap

- 当前还没有开始 `regulations/scoped_rules` 的 chunk-prep / quality acceptance。
- 本轮仍未触发 embedding、Qdrant write、release 或 alias publish。
