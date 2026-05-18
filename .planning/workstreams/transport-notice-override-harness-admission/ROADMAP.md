---
doc_type: roadmap
status: completed
created: 2026-05-07
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 MD060 -->

# Roadmap: Transport Notice Override Harness Admission

## Planned Phases

- [x] **Phase 0: Boundary, Owner Matrix And Dependency Freeze**
  Freeze positive owner split across notice consumption, campus-services baseline,
  supervisor runtime, RAG grounding, finalizer and eval.

  Exit artifacts:
  - `OWNER-RUNTIME-MATRIX.md` accepted
  - `READINESS-MATRIX.md` external dependency rows filled
  - explicit non-reopen posture for completed harness / notice / campus-services workstreams

  Exit tests:
  - markdownlint for this workstream
  - no code changes required

- [x] **Phase 1: NoticeChangeSet Contract And Data-Plane Admission**
  Define bounded `notice_change_set` schema, producer name, source truth inputs,
  admission gates and fail-close reasons.

  Exit artifacts:
  - `NOTICE-CHANGE-SET-CONTRACT.md` implemented as code-facing design
  - `configs/runtime/workflow-artifacts.v1.json` changes `notice_change_set` from
    `planned_contract_gap` to an explicitly supported or contract-only state only after producer
    truth exists
  - source-truth gate rejects searchable-only, stale, incomplete-media and unsupported notices

  Exit tests:
  - artifact registry loader/drift tests
  - notice change-set schema/validator tests
  - ingestion projection/read-model admission tests

- [x] **Phase 2: Producer Implementation And Baseline Gate**
  Implement the read-only producer that returns current, bounded transport notice changes.

  Exit artifacts:
  - repo-owned producer binding, default proposed name `campus_notice_change_set_lookup`
  - PG/read-model query path that consumes only admitted projection truth
  - official baseline availability check and baseline/current-window conflict semantics
  - no query-time raw notice/OCR/HTML/object lookup

  Exit tests:
  - baseline available / missing tests
  - temporary overlay / durable baseline delta / expired historical tests
  - conflict and evidence-incomplete fail-close tests

- [x] **Phase 3: Shared Execution Contract Promotion**
  Promote `notice_change_set` into shared workflow projection contracts.

  Exit artifacts:
  - `StepOutputProjectionKind` enum / schema updated
  - Go `StepOutputProjection` constructor and validator
  - OpenAPI and generated Go/Python/TS contracts refreshed
  - Python bridge parser accepts projection refs only, not raw payload

  Exit tests:
  - contract fixture matrix tests
  - Go execution projection validation tests
  - Python bridge parser / generated model tests
  - contract generation `--check`

- [x] **Phase 4: Capability Graph And Resolver Admission**
  Register the composite transport capability in artifact graph and compile it through
  `CapabilityPlan -> resolver -> WorkflowPlan`.

  Exit artifacts:
  - `workflow-artifacts.v1.json` producer/consumer binding for `notice_change_set`
  - resolver path:
    `schedule_baseline -> notice_change_set -> grounding_verdict/evidence_bundle -> finalizer`
  - no planner scenario branch that hard-codes fixed transport override steps

  Exit tests:
  - Go structuredplanning resolver tests
  - policy/planner tests proving planner emits capability intent, not fixed workflow
  - ambiguity tests for route/direction/current-window missing inputs

- [x] **Phase 5: Runtime Execution And Finalizer Integration**
  Execute the workflow with bounded projections and make finalizer artifact usage explicit.

  Exit artifacts:
  - workflow context only passes projection refs / safety summaries
  - finalizer reads `schedule_baseline` and `notice_change_set`
  - grounding step emits `evidence_bundle` / `grounding_verdict` when answer synthesis needs it
  - final response includes source-backed title/source URL refs where notice changes are used

  Exit tests:
  - Go `internal/httpapi` multi-step finalizer tests
  - Python worker / agent runner tests if an agent handoff is involved
  - trace redaction tests proving no raw notice/provider/source payload leaks

- [x] **Phase 6: Eval Denominator And Trace Gate**
  Add release/eval coverage before any product opening.

  Required denominator classes:
  - baseline-only
  - current temporary overlay
  - durable baseline delta
  - expired / historical notice
  - missing official baseline
  - missing evidence / incomplete media-derived document
  - conflicting notices
  - route/direction ambiguity
  - source-original / "依据哪条通知" question
  - no-answer / clarification

  Exit tests:
  - workflow trace gate asserts artifact kind order and final answer artifact usage
  - tool family denominator includes transport composite cases
  - focused product-path eval stays closed until opening evidence exists

- [x] **Phase 7: Focused Smoke, Opening Decision And Closeout**
  Run focused smoke/E2E and decide whether public opening is allowed.

  Exit artifacts:
  - local or staging smoke evidence for admitted sample questions
  - open/closed verdict recorded in `STATE.md` or `GAP-LEDGER.md`
  - follow-up delegated to `public-chat-campus-services-e2e-acceptance` if public entry testing
    remains outside this workstream

  Exit tests:
  - focused Go/Python/eval suites from Phases 1-6
  - optional public/chat E2E only after runtime opening configuration is explicit

  Closeout evidence:
  - focused process smoke passed:
    `.tmp/process-smoke/transport-notice-override-final-rag-projection-4/process-smoke-summary.json`
  - opening verdict:
    supervisor-level workflow admitted; public/chat product entry delegated to
    `public-chat-campus-services-e2e-acceptance`

## Phase Ordering Rules

- Phase 1 must finish before runtime graph admission; otherwise `notice_change_set` remains a name
  without source-truth semantics.
- Phase 2 must fail closed when official baseline or admitted notice projection is missing.
- Phase 3 must finish before any Python bridge or finalizer consumes `notice_change_set`.
- Phase 4 cannot add planner keyword if-else; only resolver-backed workflow admission is allowed.
- Phase 6 blocks Phase 7 opening; smoke without denominator coverage is not acceptance.
