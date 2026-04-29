---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Current-State Audit And Reset Manifest

## Goal

只读确认当前已采集、已导入、已消费和旧污染状态，生成 reset manifest。不得写 DB、对象存储或下游 release。

## Tasks

1. 盘点 collector run ledger，按 source surface、status、verification status、run id 汇总。
2. 盘点 source-truth / document holding inventory，区分 `internal_notice`、`common_download_source`、`file_release_source`。
3. 盘点 derived state：projection、read model、admission、OCR/multimodal attempts。
4. 盘点 typed downstream：service-status、service-guide、transport schedule release/current/read-model。
5. 生成 `reset-manifest.dry-run.json`，列出每个表、release id、notice id 的 reset 动作。
6. 生成 backup/rollback 计划，明确哪些保留、哪些删除、哪些需人工确认。

## Acceptance

- 报告能区分 captured、source-truth、searchable、downstream consumed。
- reset manifest 默认 no-write。
- manifest 明确保留 source bucket 和 collector run ledger。

## Completion Evidence

- `../../evidence/phase-01-current-state-audit-and-reset-manifest/captured-runs-inventory.json`
- `../../evidence/phase-01-current-state-audit-and-reset-manifest/source-truth-inventory-audit.json`
- `../../evidence/phase-01-current-state-audit-and-reset-manifest/derived-state-inventory.json`
- `../../evidence/phase-01-current-state-audit-and-reset-manifest/downstream-release-inventory.json`
- `../../evidence/phase-01-current-state-audit-and-reset-manifest/reset-manifest.dry-run.json`
- `../../evidence/phase-01-current-state-audit-and-reset-manifest/reset-backup-plan.md`
