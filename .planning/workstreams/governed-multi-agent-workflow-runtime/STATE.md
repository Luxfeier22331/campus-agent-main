---
doc_type: state
workstream: governed-multi-agent-workflow-runtime
status: deferred
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Governed Multi-Agent Workflow Runtime

## Current Position

**Status:** Deferred / blocked on tool and agent single-step readiness
**Current Phase:** Phase 0 planning complete
**Last Activity:** 2026-05-01
**Last Activity Description:** Created native workstream planning and deferred implementation until prerequisite tool / agent gates are current.

## Progress

**Phases Complete:** 1
**Current Plan:** `ROADMAP.md`

## Baseline Architecture Facts

- Target architecture now describes supervisor-led governed multi-agent, not peer agent mesh.
- Go `apps/supervisor-api` owns deterministic governance, workflow plan, allowed tools, budgets, fail-close, trace, and finalization.
- Python `apps/supervisor-agent-worker` owns private semantic worker execution and domain-agent dispatch.
- Provider-native function calling is a domain-agent adapter substrate only.
- Cross-agent context must be bounded typed projection, not raw prompt/provider/source payload.
- Current architecture remains mostly single handoff / direct structured runtime; this workstream must not rewrite current truth before implementation.

## Current Blockers

- Fresh `transport_schedule_lookup` single-tool readiness evidence is required.
- Fresh `campus_notice_discover` / `campus_notice_get` readiness evidence is required.
- Fresh `navigation-agent` place/stop context output readiness evidence is required.
- Fresh `rag-agent` bounded upstream context consumption and grounding readiness evidence is required.
- Workflow trace eval denominator for multi-agent step sequence and context projections is required.
- Operator-safe workflow projection requirements must be stable enough for implementation.

## Resume Criteria

Resume implementation only when all are true:

- The prerequisite tools / agents each have current deterministic test or release-gate evidence.
- The first pilot case set is accepted with expected step sequence and fail-close truth.
- Private projection contracts are approved to stay outside `packages/contracts` for the first implementation slice.
- The owning session explicitly starts Phase 1 or later; do not opportunistically implement runtime changes under unrelated tool / agent workstreams.

## Next Slice

Phase 1: build the readiness matrix and map each dependency to current evidence, missing tests, owner workstream, and blocker status.

## Session Continuity

**Stopped At:** Phase 0 planning complete.
**Resume File:** `ROADMAP.md`
