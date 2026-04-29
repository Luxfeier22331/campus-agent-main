---
workstream: authenticated-notice-regulation-consumption
created: 2026-04-19
updated: 2026-04-30
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 9
**Current Phase Name:** First-Batch Regulation Promotion Write Gate
**Current Plan:** `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-09-first-batch-regulation-promotion-write-gate/PLAN.md`
**Total Phases:** 9
**Total Plans in Phase:** 1
**Progress:** 8/9 phases complete; Phase 9 planned
**Last Activity:** 2026-04-30
**Last Activity Description:** Reopened the workstream for a selected first-batch
promotion write gate over the `8` regulation candidates proven ready by
collected-notice Phase 6R/7 evidence. Query serving and RAG release remain out
of scope.

## Current Slice

- bounded lane 固定为当前 `11` 条 admitted regulation target
- target registry 当前划分为 `regulations/institutional_rules=2`、`regulations/scoped_rules=9`
- `Phase 6` 已完成：
  - dual-lane operator contract 收口
  - artifact triplet 保持一致
  - `institutional_rules` collection-specific lane profile/runtime wiring 接入
  - institutional-only lineage fail-close truth 保持显式
- `Phase 7` 已完成 full local-only acceptance rerun，并消费 fail-close 验收问题
- `Phase 8` 已冻结 acceptance artifacts / docs continuity，并把这条线停在 `offline_preparation`
- `Phase 9` 已规划：
  - selected cohort 固定为 `594` plus `483/485/487/493/509/564/620`
  - first-batch write gate 只能推进 selected target materialization
  - 既有 `11` 条 target rows 必须被保留
  - `32` 个 `needs_multimodal` 与 `2` 个 `manual_review` 不进入本 phase
- `school_unit_name` 已收口为 title-first / fail-close metadata；无法从 source-facing title 高置信识别时返回 `None`
- `暂行/试行` 继续保留 `force_status=provisional_in_force`

## Blockers

- 暂无 planning blocker；执行前需要先生成 selected admission artifact 与 preflight report
- embedding、Qdrant、release、alias publish、query serving 与 public-chat citation 仍不在授权范围内
- residual test debt：`tests.ingestion.internal_notice_scoped_rule_materialization_materialize_suite` 仍保留旧 duplicate-provenance 期望，和当前 duplicate `191177` 留在 source truth 的口径不一致

## Verification

- current-scope materialization 已达到 `promotion_candidate_count=11`
- `institutional_rules` materialized `2`
- `scoped_rules` materialized `9`
- final Phase 7 acceptance snapshot：`.tmp/authenticated-notice-regulation-phase07/20260424T064013Z`
- frozen evidence：`.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-08-acceptance-freeze/`
- `institutional_rules` acceptance：`passed=true`，`prepared_document_count=2`
- `scoped_rules` acceptance：`passed=true`，`prepared_document_count=9`
- Phase 9 planning inputs:
  - collected-notice Phase 6R.3 consistency verdict: `passed`
  - selected downstream-admitted regulation count: `8`
  - non-selected blocked counts: `32 needs_multimodal`, `2 manual_review`

## Reopen Guidance

- 新 admission authenticated-notice regulation target 时恢复
- `institutional_rules` / `scoped_rules` 边界被显式改写时恢复
- stop point 从 `offline_preparation` 提升到 release / query-serving 时恢复

## Session Continuity

**Stopped At:** Phase 9 planned; implementation should start with selected
admission artifact and preflight guard.
**Resume File:** `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-09-first-batch-regulation-promotion-write-gate/PLAN.md`
