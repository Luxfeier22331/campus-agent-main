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
- current phase: `Phase 10`
- current focus: reopened regression inventory 仍在进行；当前
  `internal_notice_regulation_materialization.py`、
  `tests/ingestion/test_curriculum_provider_normalize.py` 与
  `tests/test_public_docs_sync.py` 重新进入 admitted baseline，
  `pnpm decomposition:lint` 继续作为 canonical follow-up gate。
- governance gate: repo 现已新增 tracked handwritten code/test decomposition audit；`configs/lint/decomposition-baseline.json` 冻结当前存量 `800+` debt，新增超阈值文件、baseline 文件继续膨胀、或已降到阈值内仍留在 baseline，都会在独立 CI lane 中 fail-close。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- superseded plan snapshot: `../../../docs/plans/archive/superseded/repo-wide-codebase-decomposition.md`
