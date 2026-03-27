# Requirements: Campus Agent

**Defined:** 2026-03-23
**Core Value:** 先把新的 supervisor-led multi-agent 架构站稳，并用 `student_handbook` 的完整 agentic RAG 主流程证明这条架构能可靠替代高频人工答疑

## v1 Requirements

Requirements for the initial phase-1 release. Each requirement will map to exactly one roadmap phase.

### Ingestion

- [x] **ING-01**: System can ingest `student_handbook` source documents into raw storage with stable document identity and version metadata
- [x] **ING-02**: System can transform `student_handbook` documents into processed text and chunk/index artifacts suitable for retrieval query-serving
- [ ] **ING-03**: System can ingest `curriculum_plan` into raw / processed / chunk outputs without exposing it to query-serving

### Query Serving

- [x] **QRY-01**: User can ask a `student_handbook` question and receive a grounded answer sourced only from the `student_handbook` corpus
- [x] **QRY-02**: Answer response includes source citations or equivalent source identifiers that let operators trace supporting evidence
- [x] **QRY-03**: System returns a `needs_clarification` response when the request is too ambiguous for a reliable `student_handbook` answer
- [x] **QRY-04**: System returns a `no_answer` or `error` response when retrieval cannot produce a safe grounded answer

### Orchestration

- [x] **ORCH-01**: `supervisor` acts as the only query entry coordinator and routes valid phase-1 requests to `rag-specialist`
- [x] **ORCH-02**: `supervisor` and `rag-specialist` communicate only through the shared handoff contract in `packages/contracts`
- [x] **ORCH-03**: `supervisor-core` remains limited to request framing, routing, policy, response shaping, and audit projection without directly owning retrieval or ingestion logic

### Governance

- [x] **GOV-01**: Request handling propagates caller identity and group information so retrieval can enforce ACL filtering before evidence is returned
- [x] **GOV-02**: Each handled request records trace and audit data sufficient to link request identity, routed path, response status, and cited sources
- [x] **GOV-03**: Phase-1 query-serving rejects corpora outside `student_handbook`, including `curriculum_plan`

### Edge Runtime

- [x] **EDGE-01**: Public answer traffic enters through a Route-based Cloudflare Worker runtime under `apps/*` that fronts `apps/supervisor-api` without bypassing supervisor or pushing provider semantics into `packages/*`
- [x] **EDGE-02**: Worker entry mode, Worker-to-origin trust, and alternate public-entry closure (`workers.dev`, preview URLs, and direct origin admission) remain explicit and fail-closed for the public answer path

### Specialist Expansion

- [x] **AORC-03**: Supervisor can route to a non-RAG specialist, such as an `official-web` / `availability` capability, through explicit contracts instead of inline tool bundles

### Verification

- [ ] **VER-01**: Repository includes automated tests proving the `supervisor -> rag-specialist -> retrieval` path and the `completed` / `needs_clarification` / `no_answer` / `error` response semantics
- [ ] **VER-02**: Repository includes baseline smoke or eval verification for the `student_handbook` query path and ingestion path so regressions can be detected before release

## v2 Requirements

Deferred to future releases. Tracked but not part of the current roadmap.

### Additional Corpora

- **CORP-01**: User can query `curriculum_plan` through the production supervisor path after ACL, monitoring, and policy gates are approved
- **CORP-02**: User can query additional campus knowledge domains beyond `student_handbook`

### Advanced Orchestration

- **AORC-01**: Supervisor can coordinate more than one specialist in a single workflow
- **AORC-02**: Supervisor can run reflection / review loops before finalizing answers

### User Experience

- **UX-01**: User can access channel-specific escalation or scheduling flows from assistant responses
- **UX-02**: System can vary response behavior by user persona beyond retrieval ACL filtering
- **UX-03**: System maintains durable conversation memory across sessions

## Out of Scope

| Feature | Reason |
|---------|--------|
| Production query access for `curriculum_plan` | Phase-1 only prepares ingestion/cleaning/chunking and must not expand query-serving scope |
| Full corpus launch across all campus domains | Current milestone is to stabilize the `student_handbook` agentic RAG path first |
| Fine-grained persona-specific answer behavior | v1 only needs identity/groups propagation and retrieval ACL filtering |
| Complex multi-specialist parallel workflows | Current milestone may add one explicitly routed non-RAG specialist, but not a general workflow engine or broad multi-specialist orchestration matrix |
| Full HITL approval flow and durable memory | Governance hardening beyond minimum tracing/audit/ACL closure is deferred |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ING-01 | Phase 2 | Complete |
| ING-02 | Phase 3 | Complete |
| ING-03 | Phase 6 | Pending |
| QRY-01 | Phase 4 | Complete |
| QRY-02 | Phase 4 | Complete |
| QRY-03 | Phase 4 | Complete |
| QRY-04 | Phase 4 | Complete |
| ORCH-01 | Phase 5 | Complete |
| ORCH-02 | Phase 1 | Complete |
| ORCH-03 | Phase 1 | Complete |
| GOV-01 | Phase 5 | Complete |
| GOV-02 | Phase 5 | Complete |
| GOV-03 | Phase 1 | Complete |
| EDGE-01 | Phase 04.6 | Complete |
| EDGE-02 | Phase 04.6 | Complete |
| AORC-03 | Phase 03.1 | Complete |
| VER-01 | Phase 7 | Pending |
| VER-02 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-23*
*Last updated: 2026-03-27 after Phase 6 completion and mainline 04.7 sync*
