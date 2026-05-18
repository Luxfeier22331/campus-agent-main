---
doc_type: state
workstream: agents-sdk-domain-agent-adapter-pilot
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Agents SDK Domain-Agent Adapter Pilot

## Current Position

**Status:** Completed
**Current Phase:** Phase 8 complete
**Last Activity:** 2026-05-01
**Last Activity Description:** Completed closeout guardrails and docs for the SDK `notice-agent + campus_notice_get` pilot as a default-off experimental lane.

## Progress

**Phases Complete:** 9
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

- None for this closed pilot workstream.

## Final Posture

- Selected posture: `keep_experimental_lane`.
- Product default: unchanged and default-off.
- SDK scope: `notice-agent + campus_notice_get` only.
- Go ownership: admission, ToolSpec/allowed-tools derivation, workflow policy, fail-close and
  finalization remain in `apps/supervisor-api`.
- Python ownership: SDK is a private domain-agent adapter substrate only.

## Reopen Rule

Reopen only if SDK target / tool expansion is proposed, SDK raw traces or native types leak into
contracts / panel / eval / workflow trace, ToolSpec / Go allowed-tools derivation is bypassed, a
provider SDK version breaks runner/tool semantics, Phase 6 parity evidence becomes stale or fails,
or product wants to promote the SDK lane beyond explicit gate.
