# Phase 1: Contract And Boundary Guardrails - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning
**Source:** Derived from roadmap, current repository state, and supervisor design docs

<domain>
## Phase Boundary

Phase 1 is not a greenfield supervisor build anymore. The repository already contains the current-design supervisor modules (`context.py`, `routing.py`, `policy.py`, `response.py`, `audit.py`) plus supervisor and API tests. This phase therefore focuses on closing the remaining contract-and-boundary gaps needed to treat that implementation as the accepted phase-1 baseline.

The phase delivers three things:

- `supervisor-core` stays on the `DelegateToRagAgentRequest` / `DelegateToRagAgentResponse` contract boundary and does not invent a parallel handoff API
- phase-1 query policy remains explicitly limited to `student_handbook` and `rag-specialist`
- `apps/supervisor-api` remains a transport/auth/runtime shell and does not absorb routing, policy, or retrieval concerns

</domain>

<decisions>
## Implementation Decisions

### Locked by roadmap and architecture
- Phase 1 addresses `ORCH-02`, `ORCH-03`, and `GOV-03` only.
- `packages/contracts` is the only supervisor-to-specialist handoff boundary.
- `apps/supervisor-api` is limited to request construction, auth mapping, trace propagation, and HTTP JSON projection.
- `packages/supervisor-core` owns request framing, routing, policy, response shaping, and audit projection only.
- Phase-1 query-serving accepts only `student_handbook`.
- Phase-1 routes only to `rag-specialist`.

### Locked by supervisor current-design implementation docs
- Do not expand `packages/contracts` schema shape for this phase.
- Do not move retrieval, ingestion, registry, Qdrant, MinIO, or runtime host details into `supervisor-core`.
- Keep audit projection minimal: `request_id`, `trace_id`, `user_id`, `status`, `source_doc_ids`.
- Treat the existing supervisor modules as the baseline to verify and close, not as disposable scaffolding.

### Locked by current repository state
- `packages/supervisor-core/src/campus_supervisor_core/context.py` already defines `SupervisorRequestContext`.
- `packages/supervisor-core/src/campus_supervisor_core/routing.py` already enforces `student_handbook` as the phase-1 query-enabled corpus.
- `packages/supervisor-core/src/campus_supervisor_core/policy.py` and `response.py` already participate in supervisor finalization and response shaping.
- `tests/supervisor/` and `tests/api/` already contain targeted coverage that should be strengthened or aligned instead of replaced.

### The agent's Discretion
- Whether Phase 1 closure needs only tests/docs updates or also small code corrections discovered during the audit.
- Whether `packages/supervisor-core/README.md` stays concise or expands into a fuller package contract document, as long as it clearly describes current responsibilities and limits.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Repo and package constraints
- `AGENTS.md` — repo-level architecture, verification, and planning constraints
- `packages/supervisor-core/AGENTS.md` — local rules for supervisor-core ownership and phase-1 limits
- `packages/rag-specialist/AGENTS.md` — specialist-side boundary and phase-1 query-serving constraints

### Architecture and phase-1 decisions
- `docs/architecture/long-term-architecture.md` — long-term package boundaries and system layering
- `docs/architecture/supervisor-architecture.md` — supervisor long-term role, current-design module split, and current execution engine boundary
- `docs/plans/supervisor-current-design-implementation.md` — supervisor current-design implementation order, file targets, and acceptance criteria

### Shared contract and current code
- `packages/contracts/src/campus_contracts/models.py` — `AllowedCorpus`, `DelegateToRagAgentRequest`, and `DelegateToRagAgentResponse`
- `packages/supervisor-core/src/campus_supervisor_core/__init__.py` — `handle_request` entrypoint and audit sink boundary
- `packages/supervisor-core/src/campus_supervisor_core/agent.py` — current orchestration pipeline
- `packages/supervisor-core/src/campus_supervisor_core/context.py` — current internal request projection
- `packages/supervisor-core/src/campus_supervisor_core/routing.py` — current routing decision and query-enabled corpus rule
- `packages/supervisor-core/src/campus_supervisor_core/policy.py` — current specialist finalization semantics
- `packages/supervisor-core/src/campus_supervisor_core/response.py` — current response assembly and source projection
- `packages/supervisor-core/src/campus_supervisor_core/audit.py` — current audit projection
- `apps/supervisor-api/src/campus_supervisor_api/api.py` — API boundary request construction and response projection
- `packages/rag-specialist/src/campus_rag_specialist/service.py` — specialist entrypoint consumed by supervisor-core

### Test surfaces
- `tests/supervisor/test_supervisor_core.py` — request context, orchestration path, response shaping, audit expectations
- `tests/supervisor/test_supervisor_routing.py` — routing target and corpus restriction coverage
- `tests/supervisor/test_supervisor_policy.py` — specialist status finalization behavior
- `tests/api/test_supervisor_api.py` — transport/auth/runtime boundary assertions

</canonical_refs>

<specifics>
## Specific Ideas

- Plan around the fact that current code already appears close to the desired Phase 1 shape.
- Prefer a first plan that audits and tightens contract/routing/audit invariants in code and tests.
- Prefer a second plan that locks API-boundary behavior and updates supervisor-core package docs to match the accepted design.
- Keep the default verification commands aligned with repo guidance:
  - `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_routing.py tests/supervisor/test_supervisor_policy.py tests/api/test_supervisor_api.py -q`
  - `uv run --all-packages python -m unittest discover -s tests -t .`

</specifics>

<deferred>
## Deferred Ideas

- Additional specialists
- Multi-specialist workflows
- Full policy engine
- Session memory / HITL / approval flow
- Retrieval or ingestion expansion inside supervisor

</deferred>

---

*Phase: 01-contract-and-boundary-guardrails*
*Context gathered: 2026-03-23 via roadmap + current repository audit*
