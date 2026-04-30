---
doc_type: state
workstream: agents-sdk-domain-agent-adapter-pilot
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Agents SDK Domain-Agent Adapter Pilot

## Current Position

**Status:** Active, Phase 1 complete
**Current Phase:** Phase 2 ready
**Last Activity:** 2026-05-01
**Last Activity Description:** Completed default-off OpenAI Agents SDK dependency, admission gate, readiness summary, and anti-contract-leak tests without executing SDK runs.

## Progress

**Phases Complete:** 2
**Current Plan:** `ROADMAP.md`

## Baseline Architecture Facts

- Go `apps/supervisor-api` owns deterministic governance, ToolSpec/allowed-tools planning,
  fail-close, workflow policy and finalization.
- Python `apps/supervisor-agent-worker` owns private semantic worker execution and domain-agent
  dispatch.
- Agent framework / Agents SDK is allowed only as domain-agent internal substrate.
- SDK-native graph, schema, run state, trace and raw model output cannot become shared contract truth.
- Current custom provider function-call pilot remains default-off and limited to selected ToolSpec
  tools; SDK adoption must compare against it, not silently replace it.

## Current Blockers

- Phase 2+ must keep ToolSpec as canonical source.
- Phase 4+ must choose exactly one read-only pilot target before opening runtime execution.
- Phase 5+ depends on a stable sanitized trace projection shape.

## Next Slice

Phase 2: derive or validate SDK tool descriptors from ToolSpec + Go `allowed_tools`.

## Session Continuity

**Stopped At:** Phase 1 implementation complete.
**Resume File:** `ROADMAP.md`
