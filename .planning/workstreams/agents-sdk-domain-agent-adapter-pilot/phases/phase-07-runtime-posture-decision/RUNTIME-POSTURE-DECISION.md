---
doc_type: runtime_posture_decision
workstream: agents-sdk-domain-agent-adapter-pilot
phase: 07-runtime-posture-decision
status: accepted
created: 2026-05-01
updated: 2026-05-01
selected_posture: keep_experimental_lane
---

<!-- markdownlint-disable MD013 -->

# Runtime Posture Decision: Agents SDK Domain-Agent Adapter Pilot

## Selected Posture

selected_posture: keep_experimental_lane

The OpenAI Agents SDK pilot remains a default-off experimental lane for
`notice-agent + campus_notice_get`. It is not promoted to the default product runtime in Phase 7.

This decision does not change product defaults. No default env values are flipped. The accepted
product path remains Go-owned deterministic admission and Python domain-agent execution through the
existing gated adapters.

## Evidence Considered

- Phase 5 sanitized SDK trace and tool lifecycle projections are present.
- Phase 6 parity harness passes the required deterministic `campus_notice_get` denominator cases.
- Contract and source guardrails continue to reject SDK-native contract leakage.
- SDK runtime readiness still has explicit gate states for disabled, missing dependency/config,
  target/tool mismatch, and admitted posture.
- The provider tool loop remains available as the rollback denominator.
- No live latency/cost evidence was recorded in Phase 7.
- No live SDK smoke evidence was recorded in Phase 7.

## Official Design Inputs

- OpenAI Agents SDK choose-your-starting-point docs distinguish agent definitions, runtime loop,
  orchestration, tools, observability, and eval surfaces:
  `https://developers.openai.com/api/docs/guides/agents#choose-your-starting-point`
- OpenAI observability docs describe SDK tracing as debug/eval evidence for model calls, tool
  calls, handoffs, guardrails, and custom spans:
  `https://developers.openai.com/api/docs/guides/agents/integrations-observability`
- OpenAI agent eval docs recommend starting with traces while debugging, then moving to repeatable
  datasets and eval runs once good behavior is stable:
  `https://developers.openai.com/api/docs/guides/agent-evals`

## Promotion Criteria

- Phase 5 sanitized trace and lifecycle projections remain passing.
- Phase 6 parity report passes all required `campus_notice_get` denominator cases.
- Boundary checks show no SDK type, raw SDK trace, raw model output, or raw provider payload crosses
  `packages/contracts`, panel, workflow trace, or eval canonical fixtures.
- Readiness gate coverage remains stable for disabled, missing dependency/config, mismatch, and
  admitted states.
- Rollback path to the custom provider function-call loop remains available.
- Live latency/cost evidence is recorded before any default-product promotion.

## Rejection Criteria

- Reject if raw SDK/provider payload crosses repo boundary.
- Reject if SDK tool surface bypasses ToolSpec or Go `allowed_tools`.
- Reject if SDK lane cannot fail closed for wrong tool, no tool, bad args, query-service failure,
  or executed-vs-reported argument drift.
- Reject if SDK complexity exceeds custom provider-loop maintainability benefits.

## Rollout / Rollback Notes

- SDK remains scoped to `notice-agent + campus_notice_get`.
- SDK remains behind `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED`,
  `SUPERVISOR_AGENTS_SDK_ALLOWED_TARGETS`, and `SUPERVISOR_AGENTS_SDK_ALLOWED_TOOLS`.
- Go `supervisor-api` remains deterministic admission, ToolSpec/allowed-tools planning,
  fail-close, workflow trace skeleton, and finalization owner.
- Python `supervisor-agent-worker` may keep SDK as a domain-agent internal substrate only.
- Rollback is to keep or route back to the existing provider function-call loop.

## Residual Risks

- The pilot has deterministic parity evidence, but no live latency/cost evidence.
- Only `notice-agent + campus_notice_get` has SDK parity evidence.
- SDK trace semantics remain external debug evidence and must not become repo contract truth.
- No hosted MCP, local MCP, web search, file search, shell, object store, collector, ingestion, or
  index-build tool surface is admitted by this decision.

## Next Allowed Changes

- Phase 8 may close out guardrails and docs for the experimental posture.
- A separate integration lane may collect live SDK latency/cost evidence.
- A separate product-runtime rollout phase is required before default product behavior changes.
- No additional SDK tools should be admitted until a new denominator and boundary plan is created.
