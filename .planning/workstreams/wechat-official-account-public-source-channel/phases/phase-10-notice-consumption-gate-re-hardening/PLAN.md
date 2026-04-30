---
phase: "10"
name: "Notice Consumption Gate Re-hardening"
status: completed
created: 2026-04-28
updated: 2026-04-30
---

# Phase 10 Plan

## Goal

保证只有真实 page-captured source-truth 能进入 WeChat notice projection；
metadata-only 或 fetch-failed 条目只能作为 non-queryable reference/audit。

## Scope

- Projection 只消费 source-truth artifact refs。
- `bodyState != captured` 不允许 queryable。
- 有 inline images 的 captured notice 默认进入 multimodal processing candidate。
- Projection metadata 必须保留 source-truth object keys 和
  `consumer_admission_batch_id`。

## Verification

- Dry-run projection proves captured WeChat notices become pending multimodal
  rather than false queryable.
- Runtime smoke checks source-truth completeness, admission provenance, read-model
  consistency, and queryable body gate.
