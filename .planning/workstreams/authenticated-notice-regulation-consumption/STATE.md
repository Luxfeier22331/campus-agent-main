---
workstream: authenticated-notice-regulation-consumption
created: 2026-04-19
updated: 2026-04-22
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 7
**Current Phase Name:** Eleven-Target Acceptance Rerun And Gap Closure
**Current Plan:** `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-07-eleven-target-acceptance-rerun-and-gap-closure/PLAN.md`
**Total Phases:** 8
**Total Plans in Phase:** N/A
**Progress:** 6/8 phases complete
**Last Activity:** 2026-04-22
**Last Activity Description:** 完成 `institutional_rules` target-side chunk-prep parity 收口，补齐 collection-specific lane profile/runtime wiring，并把 workstream 前移到 `Phase 7`。

## Current Slice

- bounded lane 固定为 `11` 条 admitted regulation target + `scoped_rules` holding collection
- `Phase 6` 已完成：
  - dual-lane operator contract 收口
  - artifact triplet 保持一致
  - `institutional_rules` collection-specific lane profile/runtime wiring 接入
  - institutional-only lineage fail-close truth 保持显式
- `Phase 7` 负责对当前 `11` 条 target 做 full local-only acceptance rerun，并消费 fail-close 验收问题
- `Phase 8` 负责冻结 acceptance artifacts / docs continuity，并把这条线停在 `offline_preparation`
- `school_unit_name` 已收口为 title-first / fail-close metadata；无法从 source-facing title 高置信识别时返回 `None`
- `暂行/试行` 继续保留 `force_status=provisional_in_force`

## Blockers

- 不存在新的 repo-level blocker；当前主要是 bounded target-side quality closeout
- embedding、Qdrant、release、alias publish 仍不在授权范围内

## Verification

- current-scope materialization 已达到 `promotion_candidate_count=11`
- `promotion_manual_review_count=0`
- `materialized_document_count=11`
- `current_target_count=11`

## Session Continuity

**Stopped At:** `Phase 6` 已完成；下次继续时直接按 `Phase 7` 的 11-target rerun plan 执行
**Resume File:** `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-07-eleven-target-acceptance-rerun-and-gap-closure/PLAN.md`
