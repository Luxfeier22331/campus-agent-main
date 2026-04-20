---
workstream: campus-services-offline-preparation-hardening
created: 2026-04-20
updated: 2026-04-20
---

# Project State

## Current Position
**Status:** Completed
**Current Phase:** Complete
**Current Phase Name:** Closed Out After Phase 04
**Current Plan:** `<none>`
**Total Phases:** 5
**Total Plans in Phase:** 0
**Progress:** 5/5 phases complete
**Last Activity:** 2026-04-20
**Last Activity Description:** Completed `Phase 04`, moved the workstream to completed truth, and froze the reopen rule at “new `campus_services` offline-preparation priority or newly admitted bounded target”.

## Current Slice

- completed `Phase 1` artifacts:
  - context: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01-service-navigation-projection-contract-freeze/CONTEXT.md`
  - plan: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01-service-navigation-projection-contract-freeze/PLAN.md`
- completed `Phase 01.1` artifacts:
  - context: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01.1-bounded-service-navigation-multimodal-probe-and-admission/CONTEXT.md`
  - plan: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01.1-bounded-service-navigation-multimodal-probe-and-admission/PLAN.md`
  - summary: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01.1-bounded-service-navigation-multimodal-probe-and-admission/SUMMARY.md`
- completed `Phase 02` artifacts:
  - context: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/02-bounded-handbook-service-navigation-ocr-materialization/CONTEXT.md`
  - plan: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/02-bounded-handbook-service-navigation-ocr-materialization/PLAN.md`
  - summary: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/02-bounded-handbook-service-navigation-ocr-materialization/SUMMARY.md`
- completed `Phase 03` artifacts:
  - context: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/03-service-navigation-targeted-verification-and-rebuild-integra/CONTEXT.md`
  - plan: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/03-service-navigation-targeted-verification-and-rebuild-integra/PLAN.md`
  - summary: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/03-service-navigation-targeted-verification-and-rebuild-integra/SUMMARY.md`
- completed `Phase 04` artifacts:
  - context: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/04-planning-closeout-and-follow-up-routing/CONTEXT.md`
  - plan: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/04-planning-closeout-and-follow-up-routing/PLAN.md`
  - summary: `.planning/workstreams/campus-services-offline-preparation-hardening/phases/04-planning-closeout-and-follow-up-routing/SUMMARY.md`
- current forward truth:
  - bounded hybrid lane 已固定在 `packages/ingestion-core` 的 projection-local owner seam，不扩成 repo-wide multimodal parser
  - `handbook_navigation_service_catalog` 现在会物化 `flow-graph.json`、`canonical.md`、`document-units.jsonl`
  - raw ingestion 与 provider-response replay 现在共享同一 bounded hybrid helper
  - replay 只在命中 hybrid projection 时才要求真实 raw asset record，不再把所有 handbook replay 一起升级成 raw-PDF hard dependency
  - 通过的 targeted verification 目前包括：
    - selector exactness
    - hybrid helper fail-close
    - replay rebuild raw-asset convergence
    - rebuild cleanup / `flow-graph.json` accounting
  - 当前首条 bounded slice 已完成；后续不再默认继续这条线的实现工作

## Blockers

- 无；这条 workstream 已完成，后续只有在新的 `campus_services` offline-preparation 优先级或新的 bounded target admission 时才会 reopen

## Verification

- `service_catalog` 继续保持 `offline_preparation`
- handbook source-truth selector contract 已冻结到 `source_title + source_handbook_section + source_page_start/source_page_end`
- 当前真实问题已从“实现缺口”收口为 completed slice；后续只剩 future reopen routing
- 本地通过的 targeted commands：
  - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_service_navigation_hybrid_materialization`
  - `uv run --all-packages python -m unittest tests.ingestion.test_provider_result_replay_rebuild`
  - `uv run --all-packages python -m unittest tests.ingestion.test_rebuild_local_data`
- `git diff --check -- .planning/WORKSTREAMS.md .planning/workstreams/campus-services-offline-preparation-hardening/STATE.md .planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md .planning/workstreams/campus-services-offline-preparation-hardening/phases/04-planning-closeout-and-follow-up-routing/PLAN.md .planning/workstreams/campus-services-offline-preparation-hardening/phases/04-planning-closeout-and-follow-up-routing/SUMMARY.md docs/plans/archive/completed/campus-services-offline-preparation-hardening.md`
  - `pass`

## Session Continuity

**Stopped At:** workstream 已在 `Phase 04` 完成收口；后续只有在新的 bounded target 或 product priority 重新 admission 时才恢复
**Resume File:** `<none>`
