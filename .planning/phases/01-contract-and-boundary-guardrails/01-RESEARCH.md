# Phase 1 Research: Contract And Boundary Guardrails

**Phase:** 1
**Researched:** 2026-03-23
**Status:** Complete

## Executive Summary

Phase 1 planning should start from the current repository state, not from the older assumption that supervisor-core is still a thin pass-through. The repo already contains an explicit supervisor request context, routing module, finalization policy, response assembly, minimal audit projection, and dedicated supervisor/API tests. The remaining work is to confirm those pieces fully satisfy the accepted phase-1 boundaries, close any residual contract or corpus-policy leaks, and align package-level docs and verification evidence with the architecture docs.

## Current State Findings

### What is already present

- `packages/supervisor-core/src/campus_supervisor_core/context.py` projects `DelegateToRagAgentRequest` into `SupervisorRequestContext`.
- `packages/supervisor-core/src/campus_supervisor_core/routing.py` restricts phase-1 query-serving to `student_handbook` and targets only `rag-specialist`.
- `packages/supervisor-core/src/campus_supervisor_core/agent.py` already follows the desired pipeline order: context -> routing -> specialist delegation -> policy -> response assembly.
- `packages/supervisor-core/src/campus_supervisor_core/audit.py` projects the minimal audit record shape.
- `apps/supervisor-api/src/campus_supervisor_api/api.py` constructs `DelegateToRagAgentRequest` from auth/trace/payload input and projects `DelegateToRagAgentResponse` back to JSON.
- `tests/supervisor/` and `tests/api/` already target the intended current-design behavior.

### What still looks phase-relevant

- `packages/supervisor-core/README.md` is still only a one-line skeleton and does not document the accepted role split or current module boundaries.
- The roadmap Phase 1 wording now needs to be reconciled with the fact that much of the current-design implementation already exists in-repo.
- Phase-closing evidence should explicitly prove:
  - supervisor and specialist interact only through `packages/contracts`
  - `curriculum_plan` remains query-disabled at the supervisor routing boundary
  - API code does not import or implement supervisor routing/policy concerns

## Risk Assessment

### Main risks

1. **Planning from an outdated baseline**
   - Risk: producing plans that rebuild `context.py`, `routing.py`, or `policy.py` instead of verifying and tightening them.
   - Mitigation: treat existing supervisor current-design files and tests as the baseline.

2. **Boundary drift through convenience edits**
   - Risk: Phase 1 fixes accidentally add API-side orchestration or supervisor-side retrieval assumptions.
   - Mitigation: verify imports, request construction, routing constants, and cross-package type usage explicitly.

3. **False completion without package/document alignment**
   - Risk: code passes tests but package-level docs still describe the old bootstrap state, making future work regress.
   - Mitigation: close the phase with README / AGENTS alignment and explicit verification commands.

## Recommended Plan Shape

### Plan 01-01: Contract, routing, and audit invariants

Focus on code-and-test closure inside `packages/contracts`, `packages/supervisor-core`, and `tests/supervisor`.

This plan should:
- audit the current handoff path end to end
- include the existing `rag-specialist` entrypoint and specialist tests in the verification surface
- keep `DelegateToRagAgentRequest` / `DelegateToRagAgentResponse` as the only supervisor-specialist interface
- strengthen tests around `student_handbook`-only routing and minimal audit projection

### Plan 01-02: API boundary and package contract docs

Focus on `apps/supervisor-api`, `tests/api`, and `packages/supervisor-core` package docs.

This plan should:
- confirm API remains limited to auth, trace, request construction, and response projection
- prevent API-side imports of routing/policy/retrieval logic
- document the accepted supervisor-core boundary so later phases do not regress into pass-through growth

## Validation Architecture

Phase 1 already has usable test infrastructure, so validation should be lightweight and continuous rather than Wave-0 heavy.

### Automated verification layers

- Quick supervisor loop:
  - `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_routing.py tests/supervisor/test_supervisor_policy.py -q`
- Quick specialist contract loop:
  - `uv run --all-packages python -m pytest tests/specialist/test_rag_specialist.py -q`
- Quick API loop:
  - `uv run --all-packages python -m pytest tests/api/test_supervisor_api.py -q`
- Full phase gate:
  - `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_routing.py tests/supervisor/test_supervisor_policy.py tests/specialist/test_rag_specialist.py tests/api/test_supervisor_api.py -q`
  - `uv run --all-packages python -m unittest discover -s tests -t .`

### What must be sampled during execution

- After any supervisor-core contract/routing/policy edit: run the quick supervisor loop.
- After any contract-side or specialist-entrypoint edit: run the quick specialist contract loop.
- After any API-boundary change: run the quick API loop.
- After each plan completes: run the full phase gate.

### Manual verification need

No manual-only verification is required for this phase because the acceptance surface is structural and testable through code reads plus the existing Python test suites.

## Planning Notes

- Keep the phase at two plans, matching the roadmap.
- Make the second plan depend on the first so docs and API assertions reflect the final accepted supervisor-core behavior.
- Use acceptance criteria with exact strings and file paths, especially for:
  - `QUERY_ENABLED_CORPUS`
  - `DelegateToRagAgentRequest(`
  - `route_request(`
  - `build_audit_record(`
  - `handle_answer(`

---

*Phase 1 research completed: 2026-03-23*
*Planner should treat current supervisor modules as existing baseline, not future work*
