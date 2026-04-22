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
- current phase: `Phase 8`
- current focus: ingestion test decomposition tranche II 仍只剩 `tests/ingestion/test_registry_models.py` 与 `tests/ingestion/test_campusrag_ingestion_support.py`，但这两个 Phase 8 admission 仍被并发脏写占用；clean-lane fallback 已继续推进到 Phase 9，`packages/ingestion-core/src/campus_ingestion_core/curriculum_budget_evaluation.py` 已完成 façade + `*_shared.py` / `*_documents.py` / `*_probe.py` / `*_reporting.py` 收口，下一文件为 `packages/ingestion-core/src/campus_ingestion_core/curriculum_chunk_units.py`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- superseded plan snapshot: `../../../docs/plans/archive/superseded/repo-wide-codebase-decomposition.md`
