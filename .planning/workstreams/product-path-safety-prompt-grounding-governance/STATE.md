---
workstream: product-path-safety-prompt-grounding-governance
created: 2026-04-19
updated: 2026-04-19
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Complete
**Current Phase Name:** Closed Out After Phase I
**Current Plan:** `<none>`
**Total Phases:** 9
**Total Plans in Phase:** 0
**Progress:** 9/9 phases complete
**Last Activity:** 2026-04-19
**Last Activity Description:** Completed `Phase I`, then extracted the conditional moderation / HITL follow-ups into dormant seeds so this workstream closes at bounded product-path abuse controls instead of holding on future trigger-only phases.

## Current Slice

- Phase A-G baseline 继续成立；latest passing artifact 仍保持为 `.tmp/evals/student-handbook-formal-benchmark-accept-20260419T031500`
- `Phase F` 已完成：`EvidenceSource/ClaimSupport/RagResultDiagnostics` 已冻结 `source_trust_tier` 与 `source_trust_summary` contract，grounding 已区分 tier mismatch，app-api diagnostics / observability / runtime store 与 eval parser 已消费同一 truth
- `Phase G` 已完成：remote content suspicion labels 与 summary 已进入 contracts / prompt packet / grounding / service / app-api / eval parser，官方网页类疑似 prompt injection 内容会在 generation path fail-close 为 `unsupported_by_evidence`
- `Phase H` 已完成：canonical `safety_identifier` derivation、provider payload 透传、app-owned persistence、telemetry projection 与 contract/runtime validation 已收口；当前 public end-user lane 默认以 `principal:<principal_id>` 生成匿名安全标识，并对 future `session:<session_id>` fallback 保持受限预留
- `Phase I` 已完成：public/product-path 现在会在第一次 durable accept 之后用 `request_execution.safety_identifier` 做 bounded throttle，命中时固定写 `status=rejected` / `error_code=rate_limit_exceeded`；operator overview `alerts[]` 也已开始派生 `safety.rate_limit_exceeded`、`safety.remote_content_suspicion_spike`、`safety.provider_content_filter_spike`，并对后两者显式标记 `incident_backfill`
- 当前 workstream 在 `Phase I` 收口完成；`Phase J/K` 已迁出为 future seeds，不再作为这条线的 active/completed phase truth
- moderation follow-up 保留在 `.planning/seeds/SEED-001-conditional-moderation-lane.md`
- HITL approval recovery follow-up 保留在 `.planning/seeds/SEED-002-conditional-hitl-approval-recovery.md`

## Blockers

- 无；这条 workstream 已完成，后续只会在新的 product-scope / incident trigger 命中 dormant seed 时另行恢复

## Verification

- `env UV_CACHE_DIR=/tmp/uv-cache timeout 180s uv run --all-packages --no-sync python -m unittest tests.contracts.test_models tests.specialist.test_rag_specialist tests.evals.test_curriculum_live_benchmark`
- `env UV_CACHE_DIR=/tmp/uv-cache timeout 180s uv run --all-packages --no-sync python -m unittest tests.contracts.test_models tests.specialist.test_rag_prompting tests.specialist.test_rag_specialist tests.evals.test_curriculum_live_benchmark`
- `pnpm --dir apps/app-api exec vitest run test/request-diagnostics.test.ts test/request-observability.test.ts`
- `env UV_CACHE_DIR=/tmp/uv-cache timeout 180s uv run --all-packages --no-sync python -m unittest tests.shared.test_prompt_runtime tests.api.test_supervisor_api_prompt_executor tests.api.test_supervisor_api tests.contracts.test_models`
- `pnpm --dir apps/app-api exec vitest run test/chat-command.service.test.ts test/request-observability.test.ts test/telemetry.index.test.ts test/supervisor-adapter.test.ts`
- `pnpm --dir apps/app-api run typecheck`
- `pnpm --dir apps/app-api run db:generate`
- `pnpm --dir apps/app-api run db:generate` (second run: `No schema changes, nothing to migrate`)
- `pnpm --dir apps/app-api exec vitest run test/chat-command.service.test.ts test/runtime-command.store.test.ts test/operator-query.store.test.ts test/operator-query.route.test.ts`
- `pnpm --dir apps/app-api run db:generate` (`0017_stormy_vanisher.sql`)
- `gsd-sdk query workstream.list --raw --cwd /home/reptilian/code/campus-agent`
- `git -C /home/reptilian/code/campus-agent diff --check -- .planning/WORKSTREAMS.md .planning/seeds/SEED-001-conditional-moderation-lane.md .planning/seeds/SEED-002-conditional-hitl-approval-recovery.md .planning/workstreams/product-path-safety-prompt-grounding-governance/STATE.md .planning/workstreams/product-path-safety-prompt-grounding-governance/ROADMAP.md .planning/workstreams/product-path-safety-prompt-grounding-governance/REQUIREMENTS.md .planning/workstreams/product-path-safety-prompt-grounding-governance/phases/phase-i-abuse-controls-and-security-ops-loop/SUMMARY.md docs/plans/archive/completed/hallucination-governance-and-grounded-generation-execution-plan.md`

## Session Continuity

**Stopped At:** workstream 已在 `Phase I` 完成收口；后续 moderation / HITL 只作为 dormant seeds 保留，不再在这条已完成 workstream 内等待 admission
**Resume File:** `<none>`
