# Phase 11: Campus Identity, Authorization, Memory, And Restricted Document Foundation - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning and first execution slice
**Source:** Distilled from `ADR-0015`, `ADR-0022`, active identity/authz/memory plan docs, current `app-api -> supervisor-api` seam, and the current transitional ACL carrier still present in contracts and retrieval models

<domain>
## Phase Boundary

Phase 11 exists to close the gap between the already-accepted architecture and the still-transitional implementation around identity, authorization, memory, and restricted institutional documents.

This phase does not reopen:

- supervisor-led multi-agent topology
- Worker web surface / shared `app-api` product topology
- current `student_handbook` and `curriculum_plan` query-serving truth
- `official_web` control-plane ownership

Its job is narrower:

- make `apps/app-api` the explicit canonical owner of principal class and authorization projection metadata
- preserve that typed truth through `ContextProjection`
- migrate restricted-document rollout off legacy `acl_groups / campus_scope` semantics
- wire memory/personalization as typed bias only, never as authorization truth

</domain>

<decisions>
## Locked Architecture Posture

- `apps/app-api` owns canonical verified identity, authorization truth, profile memory, and session memory.
- `apps/supervisor-api` only admits internal execution callers and forwards typed projection into the execution engine.
- `packages/supervisor-core`, `packages/rag-specialist`, and `packages/retrieval-core` consume projection; they do not reconstruct raw auth truth.
- restricted documents must fail closed before candidate retrieval.
- personalization may influence intent framing, retrieval planning, clarification, and wording, but it must not grant permissions.

## Current Implementation Gaps

- `apps/app-api/src/modules/auth/principal.ts` distinguishes more principal types, but the execution actor/context seam still lacks explicit canonical principal-class metadata.
- `packages/contracts/src/campus_contracts/models.py` still carries actor `groups/campus_scope` and retrieval `acl_groups/campus_scope` as transitional carrier fields without a stronger principal / projection-source marker.
- `apps/app-api/src/modules/integration/supervisor.ts` and `apps/supervisor-api/src/campus_supervisor_api/api.py` still treat the typed context seam as mostly phase-1 ACL projection.
- `apps/app-api/src/campus_app_api/projection.py` can build `ContextProjection`, but it still defaults to transitional authz semantics.
- `packages/retrieval-core/src/campus_retrieval_core/models.py` still preserves legacy top-level `campus_scope` / `acl_groups` fallback alongside the newer authorized filter.

## Explicitly Rejected Directions

- do not treat Better Auth login as campus entitlement truth
- do not let Cloudflare / edge admission stand in for document authorization
- do not let profile memory or session slots widen restricted-document visibility
- do not turn legacy `acl_*` carrier fields into the long-term authorization model
- do not reintroduce actor `snapshot` or raw token/session payloads into the shared seam

</decisions>

<canonical_refs>
## Canonical References

### Architecture and decisions

- `AGENTS.md`
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `docs/plans/intent-memory-acl-foundation.md`
- `docs/plans/campus-identity-and-restricted-document-foundation.md`
- `.planning/workstreams/restricted-document-rollout-verification/README.md`

### Current code truth

- `apps/app-api/src/modules/auth/principal.ts`
- `apps/app-api/src/modules/runtime-command/service.ts`
- `apps/app-api/src/modules/integration/supervisor.ts`
- `apps/app-api/src/campus_app_api/projection.py`
- `apps/supervisor-api/src/campus_supervisor_api/api.py`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/retrieval-core/src/campus_retrieval_core/models.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- `packages/rag-specialist/src/campus_rag_specialist/intent.py`

### Existing tests worth extending

- `apps/app-api/test/principal-resolution.test.ts`
- `apps/app-api/test/supervisor-adapter.test.ts`
- `apps/app-api/test/chat-command.service.test.ts`
- `tests/app_api/test_projection.py`
- `tests/contracts/test_models.py`
- `tests/api/test_supervisor_api.py`
- `tests/retrieval/test_backend_qdrant.py`
- `tests/retrieval/test_service.py`
- `tests/specialist/test_rag_specialist.py`

</canonical_refs>

<workstreams>
## Proposed Workstreams

### Workstream 1: Canonical principal taxonomy and projection seam

- add explicit principal-class metadata to the typed actor seam
- add explicit authorization projection-source metadata
- keep current retrieval filter shape compatible while making the source of truth visible

### Workstream 2: Restricted-document authz projection in data plane

- move registry / chunk / index primary projection to `visibility_* + entitlement_*`
- keep legacy `acl_* / campus_scope` only as controlled compatibility mirror during migration
- make restricted rollout collection-aware instead of chunk-only folklore

### Workstream 3: Restricted retrieval fail-close behavior

- ensure unauthorized principals never retrieve restricted evidence candidates
- block snippet / citation / anchor / existence leakage on deny paths
- keep deny semantics surface-aware across public chat, panel, operator, and service paths

### Workstream 4: Memory and personalization wiring

- carry typed profile/session memory through `ContextProjection`
- teach supervisor / `rag-specialist` where typed personalization can safely bias behavior
- preserve the rule that memory does not authorize access

### Workstream 5: Compatibility cleanup and verification

- remove long-lived dependence on transitional top-level ACL carrier fields
- expand allow/deny matrix, leakage regression, and telemetry coverage
- treat app-owned authz projection as the only canonical downstream input

</workstreams>

<verification>
## Verification Targets

- `pnpm web:test`
- `pnpm web:typecheck`
- `uv run --all-packages python -m unittest tests.app_api.test_projection`
- `uv run --all-packages python -m unittest tests.contracts.test_models`
- `uv run --all-packages python -m unittest tests.api.test_supervisor_api`
- targeted retrieval / specialist tests once the restricted rollout reaches 11-03 and 11-04

Success means:

- the shared seam carries principal class and projection source explicitly
- `app-api` remains the canonical authz/memory owner
- memory cannot mutate authorization truth
- restricted rollout tasks can proceed without re-opening architecture intent

</verification>

<deferred>
## Deferred Ideas

- concrete campus IdP or directory-sync product selection
- delegated admin or policy-authoring UI
- field-level masking / redaction engines
- cross-campus federation and multi-tenant policy distribution

</deferred>

---

*Phase: 11-campus-identity-authorization-memory-and-restricted-document-foundation*
*Context gathered: 2026-04-02 from current merged truth plus the new identity/authz/memory rollout plans*
