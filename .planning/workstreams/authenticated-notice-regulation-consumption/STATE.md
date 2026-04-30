---
workstream: authenticated-notice-regulation-consumption
created: 2026-04-19
updated: 2026-04-30
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** 10
**Current Phase Name:** Regulation Serving Admission
**Current Plan:** `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-10-regulation-serving-admission/PLAN.md`
**Total Phases:** 10
**Total Plans in Phase:** 1
**Progress:** 10/10 phases complete
**Last Activity:** 2026-04-30
**Last Activity Description:** Completed regulation serving admission for the
Phase 9 first batch: provenance hardening, chunk preparation, Qdrant release
alias publication, gated reader assets, runtime profile admission and retrieval
smoke evidence.

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
- `Phase 9` 已完成：
  - selected cohort 固定为 `594` plus `483/485/487/493/509/564/620`
  - selected write gate 已执行，新增 `8` 条 target documents
  - live preflight registry 为 `institutional_rules=1`、`scoped_rules=9`
  - postflight registry 为 `institutional_rules=2`、`scoped_rules=16`
  - selected target-side acceptance 通过：institutional `1`，scoped `7`
  - `32` 个 `needs_multimodal` 与 `2` 个 `manual_review` 不进入本 phase
- `Phase 10` 已完成：
  - selected `8` 条 registry record provenance 已硬化为
    `authenticated_notice_portal`
  - `institutional_rules` 进入默认 query-serving allowlist
  - `scoped_rules` 发布 retrieval alias，但默认 query allowlist 仍拒绝
  - 两个 target scope 都已完成 mandatory chunk preparation 和 Qdrant release
    alias publish
  - gated reader assets 已发布；`public_entry_count=0`
  - retrieval smoke 证明 campus-member filter 可检索，public filter 返回 0
- `school_unit_name` 已收口为 title-first / fail-close metadata；无法从 source-facing title 高置信识别时返回 `None`
- `暂行/试行` 继续保留 `force_status=provisional_in_force`

## Blockers

- 暂无 active blocker；workstream 已收口
- public-chat citation / public reader 仍不在授权范围内
- `scoped_rules` 默认 query allowlist 仍关闭；只有显式 internal path 可消费其
  retrieval-ready data-plane
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
- Phase 9 execution evidence：
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-09-first-batch-regulation-promotion-write-gate/materialization.execute.json`
  - materialized document count: `8`
  - target postflight counts: `institutional_rules=2`, `scoped_rules=16`
  - selected acceptance: `passed=true`
  - serving closed assertion: query serving / RAG release / Qdrant alias /
    public-chat citation all closed
- Phase 10 serving admission evidence：
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-10-regulation-serving-admission/provenance-hardening.execute.json`
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-10-regulation-serving-admission/chunk-preparation.institutional-rules.json`
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-10-regulation-serving-admission/chunk-preparation.scoped-rules.json`
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-10-regulation-serving-admission/release.institutional-rules.publish.json`
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-10-regulation-serving-admission/release.scoped-rules.publish.json`
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-10-regulation-serving-admission/reader-assets.execute.stdout.json`
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-10-regulation-serving-admission/retrieval-smoke.institutional-rules.json`
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-10-regulation-serving-admission/retrieval-smoke.institutional-rules.public-filter.json`

## Reopen Guidance

- 新 admission authenticated-notice regulation target 时恢复
- `institutional_rules` / `scoped_rules` 边界被显式改写时恢复
- `scoped_rules` 被提升为默认 query allowlist 时恢复
- public-chat citation / public reader 被显式打开时恢复
- regulation serving evidence 与当前 runtime/profile/alias truth 漂移时恢复
- `32` 个 multimodal blocked 或 `2` 个 manual-review rows 被解决时恢复

## Session Continuity

**Stopped At:** Phase 10 completed; no active continuation task.
**Resume File:** `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-10-regulation-serving-admission/SUMMARY.md`
