---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Dry-Run Reimport And Universal Search Preview

## Goal

用当前已采集对象做 no-write reimport preview，并证明全量可检索层可以覆盖 valid captured notices。

## Tasks

1. 从 verified run/object refs 生成 reimport plan。
2. dry-run 构建 source-truth / document holding preview。
3. dry-run 构建 searchable notice projection/read-model preview。
4. 输出 searchable coverage report。
5. 输出 invalid/defer/requires-multimodal report。

## Acceptance

- dry-run 不写 DB 和对象存储。
- 每条 valid captured notice 都有 searchable unit。
- searchable unit 有 title、date、source URL、body/search text、attachment refs、OCR/multimodal status 和 provenance。
