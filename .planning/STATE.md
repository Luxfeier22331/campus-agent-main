---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
stopped_at: Completed 03.2-source-truth-fan-out-and-attachment-projection-01-PLAN.md
last_updated: "2026-03-26T08:24:37.360Z"
progress:
  total_phases: 17
  completed_phases: 10
  total_plans: 29
  completed_plans: 24
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-25)

**Core value:** 先把新的 supervisor-led multi-agent 架构站稳，并用 `student_handbook` 的完整 agentic RAG 主流程证明这条架构能可靠替代高频人工答疑
**Current focus:** Phase 03.2 — source-truth-fan-out-and-attachment-projection

## Current Position

Phase: 03.2 (source-truth-fan-out-and-attachment-projection) — EXECUTING
Plan: 2 of 2

## Performance Metrics

**Velocity:**

- Total plans completed: 23
- Average duration: mixed agent-run and inline execution; see per-plan summaries
- Total execution time: 0.2 hours + 2026-03-24 inline Phase 2/3 execution

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 2 | 9 min | 4.5 min |
| 02 | 2 | inline session | n/a |
| 03 | 2 | inline session | n/a |
| 03.1 | 3 | 53 min | 17.7 min |
| 04.1 | 3 | inline session | n/a |
| 04.2 | 2 | inline session | n/a |
| 04.3 | 2 | inline session | n/a |
| 04.4 | 2 | inline session | n/a |
| 04.5 | 2 | inline session | n/a |
| 04.6 | 3 | inline session | n/a |

**Recent Trend:**

- Last 5 plans: 04.4-02, 04.5-01, 04.5-02, 04.6-02, 04.6-03
- Trend: Cloudflare public-entry runtime line is implemented, and the 2026-03-26 handbook chunk-truth revalidation cleared the mainline data-plane blocker

| Phase 01-contract-and-boundary-guardrails P01 | 4m | 2 tasks | 11 files |
| Phase 01 P02 | 5 | 2 tasks | 3 files |
| Phase 02 P01 | inline | 2 tasks | 7 files |
| Phase 02 P02 | inline | 2 tasks | 6 files |
| Phase 03 P01 | inline | 2 tasks | see summary |
| Phase 03 P02 | inline | 2 tasks | see summary |
| Phase 03.1 P01 | 22 min | 2 tasks | 18 files |
| Phase 03.1 P02 | 12 min | 2 tasks | 11 files |
| Phase 03.1 P03 | 19 min | 2 tasks | 8 files |
| Phase 04.1 P01 | inline | 2 tasks | see summary |
| Phase 04.1 P02 | inline | 2 tasks | see summary |
| Phase 04.1 P03 | inline | 1 task | see summary |
| Phase 04.2 P01 | inline | 1 task | 2 files |
| Phase 04.2 P02 | inline | 1 task | 1 file |
| Phase 04.3 P01 | inline | 1 task | 2 files |
| Phase 04.3 P02 | inline | 1 task | 1 file |
| Phase 04.4 P01 | inline | 1 task | 2 files |
| Phase 04.4 P02 | inline | 1 task | 1 file |
| Phase 04.5 P01 | inline | 2 tasks | 3 files |
| Phase 04.5 P02 | inline | 1 task | 1 file |
| Phase 04.6 P01 | inline | 2 tasks | 10 files |
| Phase 04.6 P02 | inline | 1 task | 2 files |
| Phase 04.6 P03 | inline | 1 task | 4 files |
| Phase 03.2-source-truth-fan-out-and-attachment-projection P01 | 17min | 2 tasks | 5 files |

## Accumulated Context

### Roadmap Evolution

- Phase 03.1 inserted after Phase 3: Availability Specialist 最小闭环 (URGENT)
- Phase 03.2 inserted after Phase 3: Source Truth Fan-Out And Attachment Projection (URGENT)
- Phase 04.1 inserted after Phase 4: Cloudflare Entry And Protected Internal Panel Design (URGENT)
- Phase 04.2 inserted after Phase 04.1: Cloudflare Runtime Topology And Delivery Shape (URGENT)
- Phase 04.3 inserted after Phase 04.2: Public Entry Edge Integration Contract (URGENT)
- Phase 04.4 inserted after Phase 04.3: Protected Internal Panel Runtime Shell (URGENT)
- Phase 04.5 inserted after Phase 4: Cloudflare Worker Consumer Entry And Access Policy (URGENT)
- Phase 04.6 inserted after Phase 4: Cloudflare Worker Runtime Implementation (URGENT)
- Phase 04.7 inserted after Phase 4: Public Consumer Chat App Design (URGENT)
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
- [Phase 01-contract-and-boundary-guardrails]: Phase-1 regression tests now explicitly gate student_handbook-only routing, supervisor-facing request handling, and minimal audit projection.
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
- [Current correction]: `/api/v1/answer` now constructs a supervisor-facing request contract instead of hardcoding a rag-specialist handoff. — This restores the external-entry/internal-handoff boundary and keeps specialist selection inside supervisor-core.
- [Current correction]: Supervisor-core now fail-closes conflicting routing input, enforces query-enabled scope policy in code, and emits stable supervisor error taxonomy plus richer audit route fields. — This removes remaining rag-default hidden assumptions from the supervisor entry chain without pushing policy back into the API shell.
- [Phase 03.1]: The repo now has a deterministic availability smoke proof that exercises the real default supervisor path with `httpx.MockTransport`. — This satisfies the eval gate for introducing the non-RAG specialist boundary.
- [Phase 04.1]: Cloudflare public entry is now frozen as an edge/runtime boundary in front of `apps/supervisor-api`, while public entry and protected internal panel are explicitly split into two surfaces. — This prevents Cloudflare work from drifting into edge orchestration or package-boundary changes.
- [Phase 04.1]: Protected panel work is now constrained to a future `apps/` runtime surface with `panel -> runtime APIs only`, and Cloudflare access identity is explicitly separated from `SupervisorRequest.actor`, retrieval ACL, and audit ownership. — This keeps Phase 5 focused on app-layer actor/ACL/audit closure instead of reopening edge-boundary design.
- [Current planning decision]: Because handbook chunk-truth work is still blocking the mainline, Cloudflare follow-up is expanded into inserted phases 04.2, 04.3, and 04.4. — These phases stay strictly at edge/runtime/panel-shell level and remain forbidden from reopening `packages/*` boundaries or Phase 5 application-layer ownership.
- [Phase 04.2]: Runtime topology is now frozen as public hostname -> `apps/supervisor-api` origin and protected hostname -> separate future `apps/` panel origin, with rollback defined by surface/origin boundary. — This gives later Cloudflare work a stable delivery topology without collapsing app boundaries.
- [Phase 04.2]: Delivery ownership for hostname, secrets/config, health/readiness, origin route, and rollback is now explicitly handed off to 04.3/04.4 planning. — This keeps edge/runtime delivery work separate from Phase 5 actor, ACL, and audit ownership.
- [Phase 04.3]: Public entry is now frozen as a Cloudflare-to-`apps/supervisor-api` runtime integration contract covering forwarding, trace/request-id propagation, cache/body-size posture, timeout/streaming assumptions, and runtime-seam health. — This keeps ingress implementation details out of `packages/*` and separate from Phase 5 actor/ACL/audit work.
- [Phase 04.4]: Protected panel is now frozen as a future `apps/` runtime shell with `panel -> runtime APIs only`, explicit fail-closed assumptions, and a no-`packages/*` / no-hidden-admin rule. — This closes the panel-shell design line without dragging UI, business workflow, or governance closure into the current phase.
- [Phase 04.5]: Public answer access policy is now frozen as `public hostname -> Cloudflare Route -> Cloudflare Worker -> trusted origin/apps/supervisor-api`, with only `authenticated-only` and explicit-flag `anonymous-enabled` modes. — This keeps Worker access policy at the runtime seam and out of `packages/*`.
- [Phase 04.5]: Worker-side Access JWT validation, `X-Worker-Origin-Auth` trust projection, and `workers_dev = false` / `preview_urls = false` closure are now explicit downstream implementation rules. — This prevents public-entry bypass while keeping Phase 5 actor/ACL/audit ownership deferred.
- [Phase 04.6]: A real `apps/public-entry-worker` runtime shell now fronts the public answer path with Route-based config, explicit entry-mode gating, and allowlisted origin forwarding. — This turns the 04.x Cloudflare line from design truth into runnable runtime code without leaking provider semantics into `packages/*`.
- [Phase 04.6]: `apps/supervisor-api` now supports `trusted-worker` origin auth and runtime-owned actor context. — This closes the Worker-to-origin seam while still deferring app-layer actor, ACL, and audit closure to Phase 5.
- [Current correction]: 2026-03-26 real handbook validation and three extra sample batches reconfirmed chunk-truth stability, with `chunk_failures = []` and `heading_body_glue_count = 0`. — Phase 4 is no longer blocked by unresolved handbook cleanup/chunking defects.
- [Current planning decision]: Future handbook-derived collections or attachment outputs must not trigger a second raw-consumption lane. — Phase 03.2 now freezes the direction as `single source consumption + multi-projection fan-out + replay from source truth`.
- [Phase 03.2-source-truth-fan-out-and-attachment-projection]: Phase 03.2 now freezes the data-plane as raw -> source truth -> declared projections -> document/chunk/index.
- [Phase 03.2-source-truth-fan-out-and-attachment-projection]: Later handbook-derived outputs must rebuild from persisted source truth instead of returning to raw.

### Pending Todos

- Execute Phase 03.2 plan 02 to converge ingestion-core, replay, and legacy migration paths onto the frozen source-truth projection contract.
- Keep handbook chunk-truth validation as a regression gate during 03.2 execution so projection convergence does not regress the verified handbook baseline.

### Blockers/Concerns

- No current handbook chunk-truth blocker remains, but the data-plane still has an implementation split between handbook ingestion, handbook replay, and campus_services migration until Phase 03.2-02 converges them onto the frozen projection contract.
- Cloudflare 04.x boundary/topology/contract/shell docs are now complete; any follow-up must stay as downstream implementation against those frozen docs, not as renewed architecture churn.
- Phase 5 should consume the explicit 04.1 handoff instead of re-opening Cloudflare entry/panel boundary questions or pushing access-provider concerns into `packages/*`.

## Session Continuity

Last session: 2026-03-26T08:24:37.357Z
Stopped at: Completed 03.2-source-truth-fan-out-and-attachment-projection-01-PLAN.md
Resume file: None
