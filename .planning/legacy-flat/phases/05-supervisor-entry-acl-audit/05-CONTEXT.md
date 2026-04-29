# Phase 5: Supervisor Entry, ACL, And Audit - Context

**Gathered:** 2026-03-27
**Status:** Implemented and verified
**Source:** Refreshed from roadmap, Phase 04.1 handoff, current supervisor/api code, and current phase-1 runtime truth

<domain>
## Phase Boundary

Phase 5 closes `ORCH-01`, `GOV-01`, and `GOV-02` for the phase-1 `student_handbook` serving path.

The scope is narrow:

- keep `supervisor` as the only supported query entrypoint
- make actor / groups / campus scope reach the specialist handoff boundary in a typed way
- make request handling emit durable audit records for both success and supervisor-side failure

The phase does not reopen retrieval strategy, specialist answer semantics, Cloudflare runtime topology, panel design, or any `packages/*` boundary beyond the supervisor-owned request/audit seam.
</domain>

<decisions>
## Implementation Decisions

- `apps/supervisor-api` remains the runtime shell; it owns auth mapping, `SupervisorRequest` construction, and audit persistence.
- `packages/supervisor-core` remains the owner of audit record shape, routing, and specialist handoff.
- `trusted-worker` is the production-facing actor path for public entry:
  - origin trust still comes from `x-worker-origin-auth`
  - caller actor claims are projected from forwarded `cf-access-jwt-assertion`
- `bearer` remains a runtime/dev auth mode only and now fail-closes to a runtime-owned default actor instead of trusting client-supplied `x-actor-*` headers.
- Audit persistence is file-backed JSONL at the API shell boundary and records both successful responses and supervisor-side structured errors.
- Audit schema remains minimal and machine-checkable:
  - `request_id`
  - `trace_id`
  - `user_id`
  - `selected_target`
  - `requested_capability`
  - `requested_scope_corpus`
  - `requested_scope_collection`
  - `status`
  - `error_code`
  - `source_doc_ids`
</decisions>

<canonical_refs>
## Canonical References

- `AGENTS.md`
- `packages/supervisor-core/AGENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/REQUIREMENTS.md`
- `.planning/phases/04.1-cloudflare-entry-and-protected-internal-panel-design/04.1-PHASE5-HANDOFF.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `apps/supervisor-api/src/campus_supervisor_api/api.py`
- `apps/supervisor-api/src/campus_supervisor_api/auth.py`
- `apps/supervisor-api/src/campus_supervisor_api/settings.py`
- `packages/supervisor-core/src/campus_supervisor_core/audit.py`
- `packages/supervisor-core/src/campus_supervisor_core/framing.py`
- `tests/api/test_supervisor_api.py`
- `tests/supervisor/test_supervisor_core.py`
</canonical_refs>

<code_context>
## Existing Code Insights

- `SupervisorRequest` construction in the API shell was already the only public request entry.
- Specialist handoff already preserved `actor`, `trace`, `request_id`, and `conversation_id`.
- The remaining runtime gaps were:
  - bearer mode trusted client-provided `x-actor-*` headers
  - trusted-worker mode stopped at runtime-owned actor labels instead of projecting caller identity
  - `AUDIT_LOG_PATH` existed but no audit sink was wired
- The retrieval ACL seam itself was already specialist-owned; Phase 5 only needed to ensure actor metadata reached that seam.
</code_context>

<deferred>
## Deferred Ideas

- panel-side business workflows or admin semantics
- retrieval backend redesign
- Cloudflare/provider-specific types in `packages/*`
- fine-grained role-policy engines beyond actor/groups propagation
- release-gate smoke/eval work that belongs to Phase 7
</deferred>

---

*Phase: 05-supervisor-entry-acl-audit*
*Context refreshed and execution status updated: 2026-03-27*
