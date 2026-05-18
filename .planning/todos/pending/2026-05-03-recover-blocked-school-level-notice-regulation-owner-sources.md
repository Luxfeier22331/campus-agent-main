---
created: 2026-05-03T06:30:49+08:00
title: 人工恢复已采集校级 notice regulation 的完整 owner source
area: ingestion-regulations
owner: regulation-data-plane
priority: backlog-after-historical-regulation-denominator-expansion
files:
  - .planning/workstreams/historical-regulation-denominator-expansion/evidence/phase-06-school-level-owner-text-recovery/blocked-owner-source-backlog.json
  - .planning/workstreams/historical-regulation-denominator-expansion/evidence/phase-06-school-level-owner-text-recovery/owner-text-recovery-audit.json
  - packages/ingestion-core/src/campus_ingestion_core/historical_regulation_school_level_owner_recovery.py
---

## Problem

`historical-regulation-denominator-expansion` completed all already available
canonical/document-units/chunk work, but three校级 notice-derived regulation
records remain blocked because the captured notice bundle does not contain a
complete owner policy source.

Blocked targets:

- `355282`: `中央民族大学关于学生使用人工智能的指导意见（2026版）`
- `187233`: `中央民族大学采购工作管理办法`
- `177880`: `中央民族大学学生申诉管理办法`

They must not be admitted from wrapper/summary notice text. Doing so would create
incomplete or fabricated canonical regulation content.

## Required Human Work

Find and verify complete owner sources for the blocked targets before reopening
canonical/chunk recovery:

- For `355282`, locate the full text or official attachment for
  `中央民族大学关于学生使用人工智能的指导意见（2026版）`.
- For `187233`, locate the complete `中央民族大学采购工作管理办法` source, not only
  the revision notice or procurement notes.
- For `177880`, locate the full text or official attachment for
  `中央民族大学学生申诉管理办法`.

Acceptable source evidence:

- captured official attachment or official owner page
- complete owner text with provenance sufficient for source-truth retention
- clear source date / issuing unit when available

Not acceptable:

- notice wrapper body only
- summary / announcement excerpt only
- reconstructed content from partial notice text

## Follow-Up Execution

After complete owner source evidence exists, open a dedicated recovery slice.
That slice may materialize canonical/document-units/chunk evidence for these
targets, but must still keep embedding, index, release admission, alias publish,
document-site publish and query serving closed unless a separate release
workstream explicitly opens them.

Relevant evidence:

- `.planning/workstreams/historical-regulation-denominator-expansion/evidence/phase-06-school-level-owner-text-recovery/blocked-owner-source-backlog.json`
- `.planning/workstreams/historical-regulation-denominator-expansion/evidence/phase-06-school-level-owner-text-recovery/owner-text-recovery-audit.json`
