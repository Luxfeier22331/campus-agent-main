# Roadmap: Campus Agent

## Overview

This roadmap stabilizes the new supervisor-led architecture before it expands scope. The sequence starts by freezing the supervisor/specialist contract and phase-1 guardrails, then builds the `student_handbook` ingestion and retrieval path, wires the `supervisor` entrypoint with ACL/audit responsibilities, prepares `curriculum_plan` offline only, and finishes with repository-level verification that proves the end-to-end agentic RAG flow is safe to plan and execute.

Current roadmap truth still centers the `student_handbook` mainline as the scheduled execution path. An inserted `03.1 Availability Specialist 最小闭环` phase is now also part of the current milestone as a parallel capability line; it exists to validate one stable non-RAG specialist boundary without hiding that work inside the existing RAG phases as an implementation detail.

The public answer route is now expected to construct a supervisor-facing request rather than hardcoding a rag-specialist handoff. Default handbook scope remains a routing/policy concern, not an API-shell constant.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (03.1, 05.1): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Contract And Boundary Guardrails** - Freeze phase-1 supervisor/specialist contracts and corpus-policy limits. (completed 2026-03-23)
- [x] **Phase 2: Student Handbook Raw Ingestion** - Land stable raw ingestion identity and versioning for `student_handbook`. (completed 2026-03-24)
- [x] **Phase 3: Retrieval Corpus Preparation** - Produce processed, chunked, and indexed `student_handbook` artifacts for query-serving. (completed 2026-03-24)
- [x] **Phase 03.1: Availability Specialist 最小闭环** - Generalize the supervisor/specialist boundary enough to add an allowlisted `official-web` / `availability` specialist without collapsing back into supervisor inline tools. (completed 2026-03-25)
- [ ] **Phase 4: RAG Specialist Answer Path** - Deliver grounded `student_handbook` retrieval and answer semantics inside `rag-specialist`.
- [ ] **Phase 5: Supervisor Entry, ACL, And Audit** - Make `supervisor` the only query entrypoint with routing, identity propagation, and audit traces.
- [ ] **Phase 6: Curriculum Offline Preparation** - Prepare `curriculum_plan` ingestion outputs without opening query-serving.
- [ ] **Phase 7: Verification And Release Gate** - Prove the main path and failure semantics with automated tests and smoke/eval coverage.

## Phase Details

### Phase 1: Contract And Boundary Guardrails
**Goal**: Freeze the shared handoff contract and corpus-policy rules so phase-1 remains limited to `student_handbook` and supervisor-core does not absorb retrieval concerns.
**Depends on**: Nothing (first phase)
**Requirements**: [ORCH-02, ORCH-03, GOV-03]
**Success Criteria** (what must be TRUE):
  1. `supervisor-core` and `rag-specialist` communicate only through shared contract types in `packages/contracts`.
  2. The phase-1 route policy rejects corpora outside `student_handbook`.
  3. `apps/supervisor-api` stays limited to transport/auth/runtime concerns and does not own orchestration rules.
**Plans**: 2/2 plans complete

Plans:
- [x] 01-01: Audit and harden the existing supervisor-specialist contract, routing, and audit invariants.
- [x] 01-02: Lock API-shell boundaries and align supervisor-core package docs with the accepted current-design state.

### Phase 2: Student Handbook Raw Ingestion
**Goal**: Ingest `student_handbook` sources into raw storage with stable identity and version metadata that downstream processing can trust.
**Depends on**: Phase 1
**Requirements**: [ING-01]
**Success Criteria** (what must be TRUE):
  1. `student_handbook` source files can be imported into the raw ingestion path.
  2. Every raw document carries stable document identity and version metadata.
  3. Re-ingestion can distinguish updates from duplicate inputs.
**Plans**: 2 plans

Plans:
- [x] 02-01: Implement raw document registration and metadata persistence for `student_handbook`.
- [x] 02-02: Add validation and fixtures covering raw ingestion identity/version behavior.

### Phase 3: Retrieval Corpus Preparation
**Goal**: Transform `student_handbook` raw inputs into processed text plus chunk/index artifacts ready for retrieval query-serving.
**Depends on**: Phase 2
**Requirements**: [ING-02]
**Success Criteria** (what must be TRUE):
  1. `student_handbook` raw inputs can be converted into cleaned processed text.
  2. Processed outputs can be chunked with metadata suitable for evidence tracing.
  3. Retrieval-ready index artifacts are produced without leaking indexing details into supervisor packages.
**Plans**: 2 plans

Plans:
- [x] 03-01: Implement processed-text and chunk-generation flow for `student_handbook`.
- [x] 03-02: Produce retrieval-ready indexing artifacts and metadata needed for citations.

### Phase 03.1: Availability Specialist 最小闭环 (INSERTED)

**Goal**: Generalize the shared supervisor/specialist contract and routing baseline just enough to land a real non-RAG `availability-specialist` for allowlisted official-web reachability checks.
**Requirements**: [AORC-03]
**Depends on**: Phase 3
**Success Criteria** (what must be TRUE):
  1. `packages/contracts` and `packages/supervisor-core` no longer hardcode rag-only delegation as the only possible specialist path.
  2. A standalone `availability-specialist` can check allowlisted official-web targets and return typed observation results without being embedded into `rag-specialist` or supervisor tool bundles.
  3. Unreachable or failing targets are represented as successful observations with explicit status semantics, while true execution/configuration faults remain `error`.
**Plans**: 3/3 plans complete

Plans:
- [x] 03.1-01: Generalize shared contracts and supervisor routing targets for explicit non-RAG specialist delegation.
- [x] 03.1-02: Implement the allowlisted `availability-specialist` MVP and its observation/status mapping.
- [x] 03.1-03: Add focused routing/tests and a minimal smoke or eval slice for the availability path.

### Phase 4: RAG Specialist Answer Path
**Goal**: Deliver the retrieval-oriented `rag-specialist` behavior for `student_handbook`, including grounded answers, citations, clarification, and no-answer/error handling, on top of the generalized specialist boundary frozen before it.
**Depends on**: Phase 03.1
**Requirements**: [QRY-01, QRY-02, QRY-03, QRY-04]
**Success Criteria** (what must be TRUE):
  1. A `student_handbook` question can return a grounded answer from `rag-specialist`.
  2. Successful answers include citations or equivalent source identifiers linked to supporting evidence.
  3. Ambiguous questions return `needs_clarification` instead of a guessed answer.
  4. Retrieval failures or insufficient evidence return `no_answer` or `error` with safe response shaping.
**Plans**: 3 plans

Plans:
- [ ] 04-01: Implement retrieval request framing and evidence selection inside `rag-specialist`.
- [ ] 04-02: Shape `completed` responses with citations and confidence-driven answer assembly.
- [ ] 04-03: Implement `needs_clarification`, `no_answer`, and `error` branches for unsafe or insufficient retrieval outcomes.

### Phase 5: Supervisor Entry, ACL, And Audit
**Goal**: Make `supervisor` the only supported query entrypoint and wire end-to-end identity, routing, tracing, and audit projection for phase-1 requests.
**Depends on**: Phase 4
**Requirements**: [ORCH-01, GOV-01, GOV-02]
**Success Criteria** (what must be TRUE):
  1. Query traffic enters through a supervisor-facing request contract and is routed by `supervisor`, rather than by API-shell hardcoded specialist construction.
  2. Caller identity and group information reach retrieval-time ACL filtering before evidence is returned.
  3. Each handled request records trace and audit fields covering caller identity, route, response status, and cited sources.
**Plans**: 3 plans

Plans:
- [ ] 05-01: Wire supervisor-api runtime requests into supervisor-core framing and route evaluation.
- [ ] 05-02: Propagate identity/groups into retrieval ACL decisions through the handoff contract.
- [ ] 05-03: Add audit projection and trace recording for routed supervisor requests.

### Phase 05.1: 研究 curriculum 的 chunking 策略 (INSERTED)

**Goal:** Freeze the evidence-backed offline-only `curriculum_plan` chunking boundary, config ownership, and sample-backed candidate semantics so Phase 6 can implement against current repo truth without accidental query-serving scope expansion or premature semantic-contract freeze.
**Requirements**: []
**Depends on:** Phase 5
**Plans:** 2 plans

Plans:
- [ ] 05.1-01-PLAN.md — 对齐 `curriculum/curriculum_plan` 的 docs/config/runtime boundary，明确哪些规则已冻结、哪些 chunking 语义仍是 candidate。
- [ ] 05.1-02-PLAN.md — 基于现有 curriculum samples/tests 补齐 fail-closed、normalization 与 candidate chunking 行为的自动化验证，不把候选语义误写成最终 contract。

### Phase 6: Curriculum Offline Preparation
**Goal**: Prepare `curriculum_plan` raw, processed, and chunk outputs as an offline data-plane path without exposing it to query-serving.
**Depends on**: Phase 05.1
**Requirements**: [ING-03]
**Success Criteria** (what must be TRUE):
  1. `curriculum_plan` documents can be imported into the offline ingestion path.
  2. `curriculum_plan` can be cleaned and chunked using the same data-plane conventions as `student_handbook`.
  3. No production query-serving route exposes `curriculum_plan`.
**Plans**: 2 plans

Plans:
- [ ] 06-01: Add raw/processed/chunk support for `curriculum_plan` in ingestion flows.
- [ ] 06-02: Verify query-serving policy continues to exclude `curriculum_plan` after offline prep is added.

### Phase 7: Verification And Release Gate
**Goal**: Establish repository-level proof that the end-to-end phase-1 path behaves correctly and regressions are caught before release.
**Depends on**: Phase 6
**Requirements**: [VER-01, VER-02]
**Success Criteria** (what must be TRUE):
  1. Automated tests cover the `supervisor -> rag-specialist -> retrieval` flow and all terminal response semantics.
  2. Smoke or eval coverage exercises the `student_handbook` query path and ingestion path.
  3. Verification outputs are repeatable enough to serve as a release gate for phase-1 changes.
**Plans**: 2 plans

Plans:
- [ ] 07-01: Add and stabilize automated test coverage for happy-path and failure-path supervisor/rag interactions.
- [ ] 07-02: Add smoke/eval verification for `student_handbook` ingestion and query-serving behavior.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 03.1 → 4 → 5 → 05.1 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Contract And Boundary Guardrails | 2/2 | Complete   | 2026-03-23 |
| 2. Student Handbook Raw Ingestion | 2/2 | Complete | 2026-03-24 |
| 3. Retrieval Corpus Preparation | 2/2 | Complete | 2026-03-24 |
| 03.1. Availability Specialist 最小闭环 | 3/3 | Complete | 2026-03-25 |
| 4. RAG Specialist Answer Path | 0/3 | Not started | - |
| 5. Supervisor Entry, ACL, And Audit | 0/3 | Not started | - |
| 05.1. Curriculum Chunking Strategy | 0/2 | Not started | - |
| 6. Curriculum Offline Preparation | 0/2 | Not started | - |
| 7. Verification And Release Gate | 0/2 | Not started | - |
