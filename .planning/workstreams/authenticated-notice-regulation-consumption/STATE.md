---
workstream: authenticated-notice-regulation-consumption
created: 2026-04-19
updated: 2026-04-20
---

# Project State

## Current Position

**Status:** Deferred
**Current Phase:** 5
**Current Phase Name:** Target-side Chunk And Quality Acceptance
**Current Plan:** paused; Phase 5 继续作为 target-side quality umbrella，后续已明确拆成 `Phase 6-8` 三个 execution-ready slices，待 workstream reopen 后按顺序恢复
**Total Phases:** 8
**Total Plans in Phase:** N/A
**Progress:** 4/8 phases complete
**Last Activity:** 2026-04-20
**Last Activity Description:** 将剩余 `notice -> chunk` 工作显式拆成 `Phase 6-8`：institutional_regulations lane parity、11-target rerun/gap closure、evidence freeze/closeout。

## Current Slice

- bounded lane 固定为 `11` 条 admitted regulation target + `scoped_rules` holding collection
- 当前继续做 target-side chunk prep、metadata 与 quality hardening
- `Phase 6` 负责把 `institutional_regulations` target-side chunk-prep / validation 收口到与 `scoped_rules` 对齐的 repo-native lane
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

**Stopped At:** workstream deferred while `notice -> chunk` 剩余工作已拆成 `Phase 6-8`；后续从 `institutional_regulations` lane parity 开始，顺序推进 rerun/gap closure 与 evidence freeze，shared loader / legacy Office follow-up 已在 `shared-file-asset-loader-contract` workstream 收口，只有 future reopen rule 命中时才会恢复
**Resume File:** docs/plans/internal-notice-policy-regulation-consumption-implementation.md
