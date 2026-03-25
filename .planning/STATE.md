---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 03.1-02-PLAN.md
last_updated: "2026-03-25T03:48:59Z"
progress:
  total_phases: 9
  completed_phases: 3
  total_plans: 11
  completed_plans: 8
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-25)

**Core value:** 先把新的 supervisor-led multi-agent 架构站稳，并用 `student_handbook` 的完整 agentic RAG 主流程证明这条架构能可靠替代高频人工答疑
**Current focus:** Phase 03.1 — availability-specialist

## Current Position

Phase: 03.1 (availability-specialist) — EXECUTING
Plan: 3 of 3
Status: Ready to execute 03.1-03
Last activity: 2026-03-25 — Completed 03.1-02 availability-specialist package and default supervisor wiring

## Performance Metrics

**Velocity:**

- Total plans completed: 7
- Average duration: mixed agent-run and inline execution; see per-plan summaries
- Total execution time: 0.2 hours + 2026-03-24 inline Phase 2/3 execution

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 2 | 9 min | 4.5 min |
| 02 | 2 | inline session | n/a |
| 03 | 2 | inline session | n/a |

**Recent Trend:**

- Last 5 plans: 02-02, 03-01, 03-02, 03.1-01, 03.1-02
- Trend: Stable upward

| Phase 01-contract-and-boundary-guardrails P01 | 4m | 2 tasks | 11 files |
| Phase 01 P02 | 5 | 2 tasks | 3 files |
| Phase 02 P01 | inline | 2 tasks | 7 files |
| Phase 02 P02 | inline | 2 tasks | 6 files |
| Phase 03 P01 | inline | 2 tasks | see summary |
| Phase 03 P02 | inline | 2 tasks | see summary |
| Phase 03.1 P01 | 22 min | 2 tasks | 18 files |
| Phase 03.1 P02 | 12 min | 2 tasks | 11 files |

## Accumulated Context

### Roadmap Evolution

- Phase 03.1 inserted after Phase 3: Availability Specialist 最小闭环 (URGENT)
- Phase 05.1 inserted after Phase 5: 研究 curriculum 的 chunking 策略 (URGENT)

### Decisions

Decisions are logged in `PROJECT.md` Key Decisions table.
Recent decisions affecting current work:

- Phase 1 roadmap starts with contract and boundary guardrails before more implementation work.
- Phase-1 query-serving remains restricted to `student_handbook`; `curriculum_plan` stays offline-only.
- Verification is held as a dedicated release gate phase after the main architecture path is in place.
- Phase 1 execution will treat the existing supervisor current-design code as baseline and close remaining boundary/documentation gaps instead of rebuilding the coordinator from scratch.
- `official-web` / `availability` specialist is now part of the current milestone as an inserted phase, but remains a parallel capability line rather than a rewrite of the `student_handbook` mainline.
- The availability path must land through explicit contracts and routing, not through a supervisor inline tool bundle or by folding the work into `rag-specialist`.
- [Phase 01-contract-and-boundary-guardrails]: Supervisor-core internal corpus and status typing now reuses shared contract literals instead of local duplicate schema aliases.
- [Phase 01-contract-and-boundary-guardrails]: Phase-1 regression tests now explicitly gate student_handbook-only routing, raw DelegateToRagAgentRequest passthrough, and minimal audit projection.
- [Phase 01]: apps/supervisor-api remains a transport shell; boundary confidence is locked by tests instead of moving orchestration code across packages. — The existing API implementation already fit the desired boundary, so strengthening assertions was the correct plan outcome.
- [Phase 01]: packages/supervisor-core documentation now treats the current module split as accepted phase-1 architecture rather than aspirational bootstrap scaffolding. — Package-local docs now serve as boundary evidence and align with the accepted supervisor-core ownership model.
- [Phase 02]: handbook source PDFs now enter through `register_raw_asset -> process_raw_ingestion_job`, making raw bucket + raw registry the canonical onboarding path.
- [Phase 02]: handbook normalized imports now classify `created_document_ids`, `updated_document_ids`, and `skipped_document_ids` from logical document identity plus content hash instead of only exact version tuple matches.
- [Phase 03]: handbook chunk generation now rebuilds directly from `document_units_object_key` in the document registry instead of relying on ad hoc in-memory processing inputs.
- [Phase 03]: ingestion writes `representation` as a Qdrant payload alias for `revision_track`, while retrieval stays contract-compatible and fail-closes on malformed or registry-missing metadata.
- [Phase 03.1]: Shared specialist contracts now use typed envelope branches instead of rag-only top-level request/response names. — This preserves runtime-neutral contracts while allowing explicit non-RAG delegation without overloading retrieval scope.
- [Phase 03.1]: Supervisor-core now routes by specialist target and derives source_doc_ids only from rag evidence payloads. — This keeps availability observations outside retrieval semantics while preserving minimal audit projection.
- [Phase 03.1]: A real `packages/availability-specialist` package now owns allowlisted target resolution, `httpx` probe mapping, and typed availability observations. — This lands the non-RAG capability as a stable package boundary instead of a supervisor-inline tool path.
- [Phase 03.1]: Supervisor-core default wiring now includes `availability-specialist` alongside `rag-specialist`. — This makes the explicit non-RAG path reachable through the same delegate seam used by the handbook mainline.

### Pending Todos

- Execute Phase 03.1 plan 03.
- Keep handbook chunk-truth validation tracked separately so the inserted availability work does not get mistaken for the `student_handbook` mainline.

### Blockers/Concerns

- Handbook chunk-truth validation remains the blocker for later `student_handbook` run-through work.
- Phase 03.1 still needs the final doc alignment and deterministic smoke/eval slice from 03.1-03 before the inserted availability capability is fully closed.

## Session Continuity

Last session: 2026-03-25T03:48:59Z
Stopped at: Completed 03.1-02-PLAN.md
Resume file: None
