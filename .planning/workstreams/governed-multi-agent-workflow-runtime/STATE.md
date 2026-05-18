---
doc_type: state
workstream: governed-multi-agent-workflow-runtime
status: completed
created: 2026-05-01
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# State: Governed Multi-Agent Workflow Runtime

## Current Position

**Status:** Completed
**Current Phase:** Phase 9 completed
**Last Activity:** 2026-05-06
**Last Activity Description:** Closed Phase 8/9 by making multi-step `WorkflowRun` persist
step-level `tool_call_summaries`, deriving `selected_tools` and operator summary from recorded run
truth instead of final-step inference, adding bounded provenance fallback via output projection ids,
rerunning the real `multi-agent-live-smoke` gate to PASS with zero workflow-trace failures, and
recording the repo-owned decision to keep the second governed scenario closed.

## Progress

**Phases Complete:** 9
**Current Plan:** `ROADMAP.md`

## Baseline Architecture Facts

- Target architecture now describes supervisor-led governed multi-agent, not peer agent mesh.
- Go `apps/supervisor-api` owns deterministic governance, workflow plan, allowed tools, budgets, fail-close, trace, and finalization.
- Python `apps/supervisor-agent-worker` owns private semantic worker execution and domain-agent dispatch.
- Provider-native function calling is a domain-agent adapter substrate only.
- Cross-agent context must be bounded typed projection, not raw prompt/provider/source payload.
- Current architecture remains mostly single handoff / direct structured runtime; this workstream must not rewrite current truth before implementation.
- Step-local Agents SDK runtime for future governed workflow steps now belongs here, not to
  `agents-sdk-runtime-surface-expansion`; SDK remains an admitted-step substrate and cannot own
  global workflow truth.
- `campus_notice_get` must not be reopened as a top-level ToolSpec / provider / SDK tool. The
  pilot may depend on selected notice card/context projection instead.
- `GroundingVerdict` is a `rag-agent` output in the first pilot, not a separate hidden specialist.
- Internal gates in `READINESS-MATRIX.md` are produced by later phases and must not self-block Phase
  1 readiness work.

## Closeout Facts

- `transport_schedule_lookup` row is `ready` with fresh evidence.
- `campus_notice_discover` row is `ready` with fresh evidence.
- selected notice card/context projection row is `ready` with fresh evidence.
- current `AgentSpec` / `ToolSpec` baseline row is `ready` with fresh evidence.
- `navigation-agent` place/stop context row is `not_applicable` for the current first pilot.
- `rag-agent` bounded grounding row is `ready` with fresh focused passing evidence.
- Private projection schema now has concrete Go-owned implementation for
  `schedule_baseline`, `notice_context`, `evidence_bundle`, and `grounding_verdict`.
- Go workflow admission now supports the first admitted `campus_services` pilot with selected
  notice context and `student_rules` grounding scope.
- Python step-runner / SDK-runtime minimum safe trace closeout is complete.
- Multi-step runtime now records rag-step consumed input projections as actual schedule + notice
  projection refs, not only the last required edge kind.
- Multi-step runtime now keeps bounded rag workflow projections even when the first-pilot outcome is
  `needs_clarification`; these outcomes no longer collapse into failed workflow-run state.
- Multi-step runtime now persists step-level `tool_call_summaries` in `WorkflowRun`, and finalizer
  prefers that recorded truth over final-step-only synthesis.
- Multi-step runtime now derives bounded provenance from repo-owned output projection ids when a
  source step result lacks explicit `source_refs`.
- Real `multi-agent-live-smoke` gate now passes with zero failed profiles and zero workflow-trace
  replay failures for the governed workflow profile set.

## Resume Criteria

Do not resume this workstream unless one of the following occurs:

- multi-step trace loses recorded step-level `tool_call_summaries`;
- bounded provenance disappears from recorded workflow truth or replay gate;
- `needs_clarification` / `no_answer` regress from valid completed workflow terminal outcomes;
- repo explicitly decides to admit a second governed scenario.

## Next Slice

None in this workstream. Future governed-scenario expansion belongs to a separate owner
workstream.

## Session Continuity

**Stopped At:** Phase 9 complete after operator-safe trace closeout plus second-scenario keep-closed
decision.
**Resume File:** `ROADMAP.md`
