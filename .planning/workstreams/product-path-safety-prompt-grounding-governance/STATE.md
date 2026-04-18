---
workstream: product-path-safety-prompt-grounding-governance
created: 2026-04-19
updated: 2026-04-19
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** G
**Current Phase Name:** Remote-content Injection Hardening
**Current Plan:** `.planning/workstreams/product-path-safety-prompt-grounding-governance/phases/phase-g-remote-content-injection-hardening/PLAN.md`
**Total Phases:** 11
**Total Plans in Phase:** 1
**Progress:** 6/11 phases complete
**Last Activity:** 2026-04-19
**Last Activity Description:** Completed `Phase F`: froze `T0-T3` contract/runtime mapping, projected `source_trust_summary` into app-api diagnostics/observability storage, updated eval parser consumption, and generated `request_observability_fact.source_trust_summary_json` migration.

## Current Slice

- Phase A-F baseline 继续成立；latest passing artifact 仍保持为 `.tmp/evals/student-handbook-formal-benchmark-accept-20260419T031500`
- `Phase F` 已完成：`EvidenceSource/ClaimSupport/RagResultDiagnostics` 已冻结 `source_trust_tier` 与 `source_trust_summary` contract，grounding 已区分 tier mismatch，app-api diagnostics / observability / runtime store 与 eval parser 已消费同一 truth
- 当前唯一 active slice 切到 `Phase G PLAN.md`：下一步只处理 remote content sanitization / suspicion labeling / generation fail-close，不再重开 `T0-T3` taxonomy 或 curriculum surface mapping
- `Phase H/I` 继续保持 plan-ready；其中 `Phase H` 已固定 principal/session 双路径 `safety_identifier`，`Phase I` 已固定 app-owned throttle / alert / incident backfill truth
- `Phase J/K` 继续保留在同一条线内，但只有在 repo-tracked trigger artifact 落盘并写入下方 `Conditional Trigger Registry` 后才允许从 `pending` 升成 active 实施 phase

## Conditional Trigger Registry

- `Phase J`
  - `status`: `pending`
  - `trigger_artifact_path`: `<none>`
  - `admitted_at`: `<not_admitted>`
  - `admission_reason`: `<not_admitted>`
- `Phase K`
  - `status`: `pending`
  - `trigger_artifact_path`: `<none>`
  - `admitted_at`: `<not_admitted>`
  - `admission_reason`: `<not_admitted>`

## Blockers

- 无当前 blocker；`Phase G` 可直接开始，`Phase H-K` 继续依赖后续 phase output 与 conditional trigger admission

## Verification

- `env UV_CACHE_DIR=/tmp/uv-cache timeout 180s uv run --all-packages --no-sync python -m unittest tests.contracts.test_models tests.specialist.test_rag_specialist tests.evals.test_curriculum_live_benchmark`
- `pnpm --dir apps/app-api exec vitest run test/request-diagnostics.test.ts test/request-observability.test.ts`
- `pnpm --dir apps/app-api run db:generate`

## Session Continuity

**Stopped At:** `Phase F` 已完成并落盘 migration；下一会话应直接进入 `Phase G` 的 remote-content sanitization / suspicion labeling / regression gate，而不是回到 source-trust taxonomy 讨论
**Resume File:** `.planning/workstreams/product-path-safety-prompt-grounding-governance/phases/phase-g-remote-content-injection-hardening/PLAN.md`
