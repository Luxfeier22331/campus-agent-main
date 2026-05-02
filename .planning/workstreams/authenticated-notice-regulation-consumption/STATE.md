---
workstream: authenticated-notice-regulation-consumption
created: 2026-04-19
updated: 2026-05-02
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** 13
**Current Phase Name:** Historical Regulation Canonical Backfill
**Current Plan:** `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-13-historical-regulation-canonical-backfill/PLAN.md`
**Total Phases:** 13
**Total Plans in Phase:** 1
**Progress:** 13/13 phases complete
**Last Activity:** 2026-05-02
**Last Activity Description:** Added historical selected regulation canonical
backfill so Phase 9/11 cohorts can be rebuilt through current v2 cleaning before
RAG release.

## Current Slice

- bounded lane includes the original `11` target closeout, Phase 9 first-batch
  target materialization, Phase 10 serving admission, and Phase 11 selected
  manual-review target materialization
- latest Phase 11 target registry postflight counts:
  `regulations/institutional_rules=3`、`regulations/scoped_rules=16`
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
- `Phase 11` 已完成：
  - selected manual-review cohort 固定为 `481`、`619`
  - `481` 显式 resolution 到 `regulations/scoped_rules`
  - `619` 显式 resolution 到 `regulations/institutional_rules`
  - owner-text execution status 均为 `ready`
  - target materialization execute 新增 `2` 条 target documents
  - postflight registry counts 为 `institutional_rules=3`、`scoped_rules=16`
  - query serving / RAG release / Qdrant alias / public-chat citation 均保持关闭
- `Phase 12` 已完成：
  - collected-notice regulation canonical cleaner 升级到
    `collected_notice_regulation_canonical_cleaning_v2`
  - 619 类 OCR soft-wrap 与中文可读性标点在 materialization 入库前修复
  - selected materialization execute 强制 `normalization_quality=passed`
  - document-units metadata 写入 normalizer / cleaning policy / schema / quality provenance
  - RAG release preparation 缺当前 cleaning provenance 时转入 `preparation_failed`，
    不进入 index 或 alias publish
- `Phase 13` 已完成实现：
  - first-batch historical cohort 从 admission manifest + source owner text 重建
    v2 canonical materialization preview
  - manual-review cohort 从 explicit resolution + owner-text execution report 重建
    v2 canonical materialization preview
  - 旧 Phase 6R/Phase 9/Phase 11 normalized dry-run JSON 不再作为 backfill
    canonical text input
  - 新增 worker CLI
    `campus-ingestion-backfill-collected-notice-regulation-canonical`
  - backfill 停在 canonical materialization；query serving / RAG release 继续关闭
- `school_unit_name` 已收口为 title-first / fail-close metadata；无法从 source-facing title 高置信识别时返回 `None`
- `暂行/试行` 继续保留 `force_status=provisional_in_force`

## Blockers

- 暂无 active blocker；workstream 已收口
- public-chat citation / public reader 仍不在授权范围内
- Phase 11 新 materialized targets 尚未经过 RAG release lane；不能把 target
  registry row 视为已可检索
- Phase 9 / Phase 11 既有 target artifacts 需要在目标 operator 环境运行
  Phase 13 worker `--execute` 后，才能确认 registry/object-store runtime truth 已满足 v2
  cleaning provenance
- `scoped_rules` 默认 query allowlist 仍关闭；只有显式 internal path 可消费其
  retrieval-ready data-plane
- `32` 个 `needs_multimodal` regulation candidates 仍阻塞
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
- Phase 11 manual-review admission evidence：
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-11-second-batch-manual-review-admission/manual-review-resolution-report.json`
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-11-second-batch-manual-review-admission/manual-review-resolved-admission-manifest.json`
  - `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-11-second-batch-manual-review-admission/materialization.execute.json`
  - materialized document count: `2`
  - postflight counts: `institutional_rules=3`、`scoped_rules=16`
  - serving closed assertion: query serving / RAG release / Qdrant alias /
    public-chat citation all closed
- Phase 12 cleaning hardening verification：
  - `uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_regulation_text_normalization tests.ingestion.test_collected_notice_regulation_first_batch_promotion tests.ingestion.test_regulation_rag_release_lane`
  - `uv run --all-packages python -m unittest tests.ingestion.test_prepare_institutional_regulation_chunks_worker tests.ingestion.test_prepare_scoped_rule_chunks_worker tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep tests.ingestion.test_internal_notice_scoped_rule_chunk_prep tests.ingestion.test_process_regulation_rag_release_candidates_worker`
- Phase 13 canonical backfill verification：
  - `uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_regulation_canonical_backfill tests.ingestion.test_backfill_collected_notice_regulation_canonical_worker`

## Reopen Guidance

- 新 admission authenticated-notice regulation target 时恢复
- Phase 11 新 materialized targets 进入 RAG release / serving admission 时恢复
- `institutional_rules` / `scoped_rules` 边界被显式改写时恢复
- `scoped_rules` 被提升为默认 query allowlist 时恢复
- public-chat citation / public reader 被显式打开时恢复
- regulation serving evidence 与当前 runtime/profile/alias truth 漂移时恢复
- `32` 个 multimodal blocked rows 被解决时恢复

## Session Continuity

**Stopped At:** Phase 12 completed; existing Phase 9/11 regulation artifacts need v2
selected re-materialization before new RAG release. Phase 13 implementation now
provides that backfill path; execute it in the operator environment before RAG
release admission.
**Resume File:** `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-13-historical-regulation-canonical-backfill/SUMMARY.md`
