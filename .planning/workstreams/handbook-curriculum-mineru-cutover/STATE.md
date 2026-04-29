---
workstream: handbook-curriculum-mineru-cutover
created: 2026-04-23
updated: 2026-04-27
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** closeout
**Current Phase Name:** MinerU Cutover Complete
**Current Plan:** workstream roadmap drives execution directly; current phase has no separate PLAN file
**Total Phases:** 5
**Total Plans in Phase:** 0
**Progress:** 5/5 phases complete
**Last Activity:** 2026-04-27
**Last Activity Description:** Completed Phase 4 release dry run and Phase 5 alias publish.
`curriculum_plan` dry run produced `curriculum_plan__r20260427_000952`
with 70 documents / 1707 points. `student_rules` dry run produced
`student_rules__r20260427_001152` with 46 documents / 517 points.
Both dry runs used `--no-publish-alias`; alias guard proved serving aliases did not move
before publish. Phase 5 then published `curriculum_plan` and `student_rules` aliases to
those physical collections and post-publish retrieval alias-path benchmarks completed.

## Progress

- completed `Phase 1` truth:
  - `student_rules` 与 `curriculum_plan`
    runtime profile 已显式指向 `mineru_api + vlm + mineru-vlm-adapted-v2`
  - cutover 目标固定为覆盖现有 Paddle 派生 canonical truth，
    不保留 forward dual-track
  - rollback 边界固定为 source bucket snapshot、
    current release manifest 与 alias pointer

- completed `Phase 2` truth:
  - handbook source-truth 现在拥有 dedicated fail-close validator
  - quality-gate tests for handbook/curriculum 已切到 MinerU labels
  - 前向 runbook/reference/planning truth 正在清理 Paddle 默认叙述

- completed `Phase 3` truth:
  - `curriculum_plan` shadow rebuild:
    `.tmp/handbook-curriculum-mineru-phase3/curriculum_plan/process-raw-ingestion-job-2026-04-26T233707.342903_plus_0000.json`
    records `success_count=70`, `failed_count=0`
  - `student_rules` primary shadow rebuild:
    `.tmp/handbook-curriculum-mineru-phase3/student_rules/process-raw-ingestion-job-2026-04-26T234259.627506_plus_0000.json`
    records `success_count=46`; the only failure was a transient `502 Bad Gateway`
    from prompt-runtime service-navigation hybrid extraction
  - `student_rules` projection recovery:
    materialized the service-navigation flow-graph artifact, then replayed source truth via
    `.tmp/handbook-curriculum-mineru-phase3/student_rules_projection_replay/replay-provider-response-rebuild-2026-04-26T234700.133885_plus_0000.json`,
    which records `success_count=1`, `failed_count=0`, and restores
    `campus_services:service_catalog:d430438b1c6aa00ffff671a078c7d011852c9bed`
  - all Phase 3 rebuild/replay commands used `--no-publish-alias` /
    `REBUILD_PUBLISH_ALIAS=0`
  - `pnpm --dir apps/public-docs sync:real-docs` completed
  - `pnpm --dir apps/public-docs lint:generated` validated 120 generated public docs files

- completed `Phase 4` truth:
  - preflight confirmed `CAMPUS_SHARED_POSTGRES_URL`,
    `DOCUMENT_REGISTRY_DATABASE_URL` and `RAW_ASSET_REGISTRY_DATABASE_URL`
    all resolve to the same local shared Postgres DSN
  - current alias targets before dry run were
    `curriculum_plan -> curriculum_plan__r20260422_222417` and
    `student_rules -> student_rules__r20260422_163459`
  - `curriculum_plan` release dry run:
    `.tmp/handbook-curriculum-mineru-phase4/curriculum_plan-release-dry-run.json`
    records `validation_status=passed`, `document_count=70`, `point_count=1707`,
    `published_at=null`, and physical collection `curriculum_plan__r20260427_000952`
  - `student_rules` release dry run:
    `.tmp/handbook-curriculum-mineru-phase4/student_rules-release-dry-run.json`
    records `validation_status=passed`, `document_count=46`, `point_count=517`,
    `published_at=null`, and physical collection `student_rules__r20260427_001152`
  - Phase 4 intentionally did not use `--reset-index`; code inspection showed
    `reset_index_binding` unpublishes aliases and deletes existing physical collections,
    which conflicts with dry-run alias guard semantics
  - direct physical retrieval outputs:
    `.tmp/handbook-curriculum-mineru-phase4/curriculum_plan-retrieval-results.json`
    and `.tmp/handbook-curriculum-mineru-phase4/student_rules-retrieval-results.json`
  - `student_rules` direct retrieval now applies existing handbook query planning in
    `campus_evals.retrieval_live_benchmark`, so physical-collection acceptance matches
    product retrieval semantics for handbook object aliases
  - high-pollution national-scholarship known-bad sample no longer retrieves the forbidden
    comprehensive-evaluation document after the query-planning rewrite
  - student-card reissue regression was restored by adding the student-card handbook object
    alias to `configs/ingestion/regulations/student_rules/query-planning.json`
  - remaining `student_rules` forbidden tail hit for disciplinary relief matches current
    serving baseline and is not a new MinerU cutover regression

- completed `Phase 5` truth:
  - `curriculum_plan` alias publish:
    `.tmp/handbook-curriculum-mineru-phase4/curriculum_plan-alias-publish.json`
  - `student_rules` alias publish:
    `.tmp/handbook-curriculum-mineru-phase4/student_rules-alias-publish.json`
  - alias publish guard:
    `.tmp/handbook-curriculum-mineru-phase4/phase5-alias-publish-guard.json`
    records `curriculum_plan -> curriculum_plan__r20260427_000952` and
    `student_rules -> student_rules__r20260427_001152`
  - post-publish alias-path retrieval outputs:
    `.tmp/handbook-curriculum-mineru-phase4/curriculum_plan-post-publish-retrieval-results.json`
    and
    `.tmp/handbook-curriculum-mineru-phase4/student_rules-post-publish-retrieval-results.json`
  - `pnpm --dir apps/public-docs lint:generated` validated 120 generated public docs files
  - app-api live benchmark was not executed because `APP_API_BASE_URL` pointed at
    `http://127.0.0.1:8787`, but no local app-api service was listening on that port

## Session Continuity

**Stopped At:** Workstream complete. `student_rules` 与 `curriculum_plan` serving aliases
已切到 MinerU release physical collections；后续只应进入常规 regression / ops
monitoring，而不是继续保留 Paddle dual-track。
**Resume File:** docs/runbooks/student-handbook-hybrid-rebuild-checklist.md
