---
doc_type: phase_plan
workstream: notice-agent-card-first-tool-boundary
phase: 00-boundary-freeze
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 0: Boundary Freeze And Inventory

## Goal

Freeze the notice tool/function boundary before implementation. The output of this phase is a complete inventory and a migration decision for `campus_notice_get`.

## Locked Inputs

- Target architecture says notice user surface is card-first / source-link-first.
- `campus_notice_discover` remains agent-facing.
- Selected notice card/context/body/media reads are internal deterministic query functions unless Phase 0 proves a user-intent-level resolve tool is needed.
- Source-truth body/OCR/media retention remains in ingestion/data plane and is not removed.

## Current Known Body-Serving Paths

Phase 0 must verify and expand this list:

- `packages/notice-agent/src/campus_notice_agent/tool_adapter.py` emits `title + normalized_body`.
- `apps/supervisor-api/internal/httpapi/structured_direct_text.go` emits `title + normalized_body`.
- `packages/contracts/src/campus_contracts/models_tools.py` requires `normalized_body` for non-reference resolved notice get.
- `configs/runtime/tools.v1.json` exposes `campus_notice_get` with `function_schema.available=true` and `runtime_posture=provider_loop_pilot`.
- `apps/supervisor-api/internal/structuredplanning/planner.go` plans selected notice follow-through as `campus_notice_get`.
- `apps/supervisor-api/internal/structuredquery/notice.go` reads canonical body from object storage for `LookupCampusNoticeGet`.
- Provider/SDK tests and fixtures use `campus_notice_get` as the pilot denominator.

## Work Packages

1. Create `BOUNDARY-INVENTORY.md`.
2. Run codebase inventory with targeted searches:
   - `rg -n "campus_notice_get|normalized_body|NoticeContext|notice_context"`
   - `rg -n "provider_loop_pilot|function_schema|allowed_tools"`
   - `rg -n "workflow_trace|context_projections|safe_details"`
3. Classify each path into one of:
   - public answer rendering,
   - provider/SDK tool surface,
   - Go planner/runtime policy,
   - internal query service,
   - source-truth/body store,
   - workflow trace/context projection,
   - tests/eval fixtures,
   - docs.
4. Freeze target vocabulary:
   - `NoticeCardSet`: user-visible discovery result.
   - `ResolvedNoticeRef`: selected notice identity plus title/source/link metadata.
   - `NoticeContextProjection`: bounded internal context with source refs, content hash, short summary or extracted facts.
   - `display_policy`: explicit output policy such as `card_only`, `link_only`, `bounded_summary`, `fact_extraction_only`, `internal_materialization_only`.
   - `full_body_forbidden`: invariant for public answer and operator-safe trace.
5. Decide and record the `campus_notice_get` migration posture.

## Required Decision

Default recommended decision unless Phase 0 finds a blocker:

- Hardcut `campus_notice_get` from provider/SDK top-level tool surface.
- Preserve selected notice lookup as an internal deterministic query function.
- Rename or reframe result semantics from “get body” to selected notice ref/card/context resolution.
- Keep raw body access only inside source-truth/internal bounded context functions and downstream materialization.

## Files Expected To Be Touched

- `.planning/workstreams/notice-agent-card-first-tool-boundary/phases/phase-00-boundary-freeze/BOUNDARY-INVENTORY.md`
- `.planning/workstreams/notice-agent-card-first-tool-boundary/STATE.md`
- `.planning/workstreams/notice-agent-card-first-tool-boundary/ROADMAP.md` only if Phase 0 changes later-phase boundaries.

No production code should change in Phase 0.

## Verification

```bash
pnpm exec markdownlint-cli2 ".planning/workstreams/notice-agent-card-first-tool-boundary/**/*.md"
git diff --check
```

## Exit Criteria

- Every known body-serving path is listed with owner and target disposition.
- The `campus_notice_get` migration decision is explicit.
- Later phases can be executed without reopening the tool/function boundary question.
