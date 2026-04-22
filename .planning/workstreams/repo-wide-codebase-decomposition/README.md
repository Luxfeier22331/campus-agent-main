---
doc_type: index
status: active
created: 2026-04-22
updated: 2026-04-23
---

# Workstream: Repo-wide Codebase Decomposition

这是 `repo-wide-codebase-decomposition` 的 native workstream 入口。
它只承接 repo 级 handwritten code/test monolith decomposition，不接受功能扩 scope 或边界重写伪装成 cleanup。

## Current Status

- status: `active`
- current phase: `Phase 9`
- current focus: `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py` 与 `tests/ingestion/test_curriculum_course_map_multimodal_probe.py` 已完成 façade + focused helper/suite 收口；fresh inventory re-scan 现已无剩余 `800+` handwritten code/test files，`configs/lint/decomposition-baseline.json` 也已回到空 baseline。
- governance gate: repo 现已新增 tracked handwritten code/test decomposition audit；`configs/lint/decomposition-baseline.json` 冻结当前存量 `800+` debt，新增超阈值文件、baseline 文件继续膨胀、或已降到阈值内仍留在 baseline，都会在独立 CI lane 中 fail-close。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- superseded plan snapshot: `../../../docs/plans/archive/superseded/repo-wide-codebase-decomposition.md`
