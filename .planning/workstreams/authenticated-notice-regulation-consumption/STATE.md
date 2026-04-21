---
workstream: authenticated-notice-regulation-consumption
created: 2026-04-19
updated: 2026-04-21
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 6
**Current Phase Name:** Institutional Regulations Target Chunk-Prep Parity
**Current Plan:** `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-06-institutional-regulations-target-chunk-prep-parity/PLAN.md`
**Total Phases:** 8
**Total Plans in Phase:** N/A
**Progress:** 5/8 phases complete
**Last Activity:** 2026-04-21
**Last Activity Description:** 补齐 `Phase 6-8` 的 research/plan artifacts，并把 workstream 从 deferred 恢复到 `Phase 6` 执行入口。

## Current Slice

- bounded lane 固定为 `11` 条 admitted regulation target + `scoped_rules` holding collection
- 当前先收口 `institutional_regulations` 与既有 `scoped_rules` 的 shared operator/artifact parity seam
- `Phase 6` 负责固定：
  - dual-lane operator contract
  - artifact triplet
  - institutional-only lineage fail-close truth
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

**Stopped At:** `Phase 6` planning 已完成；下次继续时直接按 institutional lane parity plan 执行，再顺序推进 `Phase 7-8`
**Resume File:** `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-06-institutional-regulations-target-chunk-prep-parity/PLAN.md`
