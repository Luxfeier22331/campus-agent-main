---
doc_type: capability_graph
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 MD060 -->

# Capability Graph

## Purpose

This document is the Phase 2 human-readable view of the runtime capability graph.

Machine-readable source of truth:

```text
configs/runtime/workflow-artifacts.v1.json
```

The graph records which admitted runtime owner can produce which artifact, what that producer
consumes, which gate keeps it open or closed, and which eval denominator must move with it.

## Producer Matrix

| Artifact | Binding | Owner | Tool | Gate | Consumers | Notes |
| ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| `notice_context` | `notice.notice_context.selected_notice_get` | `notice-agent` | `campus_notice_get` | `open` | `rag-agent`, `supervisor-api-finalizer` | Internal selected notice resolution only; not structured handoff. |
| `schedule_baseline` | `campus_services.schedule_baseline.transport_schedule_lookup` | `campus-services-agent` | `transport_schedule_lookup` | `open` | `rag-agent`, `supervisor-api-finalizer` | Stable route and shuttle baseline. |
| `service_status_facts` | `campus_services.service_status_facts.service_status_lookup` | `campus-services-agent` | `service_status_lookup` | `open` | `rag-agent`, `supervisor-api-finalizer` | Current and temporary status facts. |
| `service_guide_facts` | `campus_services.service_guide_facts.service_guide_lookup` | `campus-services-agent` | `service_guide_lookup` | `open` | `rag-agent`, `supervisor-api-finalizer` | Stable guide facts. |
| `contact_directory_facts` | `campus_services.contact_directory_facts.contact_directory_lookup` | `campus-services-agent` | `contact_directory_lookup` | `open` | `rag-agent`, `supervisor-api-finalizer` | Directory facts only, no action execution. |
| `academic_calendar_facts` | `campus_services.academic_calendar_facts.academic_calendar_lookup` | `campus-services-agent` | `academic_calendar_lookup` | `open` | `rag-agent`, `supervisor-api-finalizer` | `calendar_fact` remains an explicit alias only. |
| `evidence_bundle` | `rag.evidence_bundle.retrieval_query` | `rag-agent` | `retrieval.query` | `open` | `rag-agent`, `supervisor-api-finalizer` | Bounded evidence step, agent-internal. |
| `grounding_verdict` | `rag.grounding_verdict.retrieval_query` | `rag-agent` | `retrieval.query` | `open` | `supervisor-api-finalizer` | Non-answer-bearing control artifact. |
| `place_context` | `navigation.place_context.place_lookup_deferred` | `navigation-agent` | none | `closed` | `campus-services-agent`, `supervisor-api-finalizer` | Registered for future rollout only; not executable now. |

## Consumer Shape

- `rag-agent` may consume bounded upstream context such as `notice_context`, `schedule_baseline`,
  `service_guide_facts`, `contact_directory_facts` and `academic_calendar_facts`.
- `supervisor-api-finalizer` may consume answer-eligible artifacts and `grounding_verdict`, but must
  not treat `grounding_verdict` itself as answer-bearing evidence.
- `campus-services-agent` is currently a producer-only owner in this graph.
- `navigation-agent` remains deferred. `place_context` is registered to keep the vocabulary stable,
  not to open a runtime path.

## Required Inputs

Current `required_inputs` vocabulary is intentionally narrow:

- `request:*`
  - request-scoped user goal or selected notice input
- `artifact:*`
  - a previously produced runtime artifact dependency

No binding may depend on raw provider transcripts, raw source payloads, object locators, SQL rows or
SDK-native traces.

## Guardrails

- `opening_gate=open` bindings must reference an active read-only ToolSpec owned by the same agent.
- `opening_gate=closed` bindings may stay registered without a ToolSpec when the capability is
  deferred, as with `place_context`.
- `state_changing=true` is forbidden in this workstream.
- Open bindings that produce the same artifact kind must have distinct priorities; equal-priority
  duplicates fail closed as ambiguous producer ownership.
- `campus_notice_get` and `retrieval.query` may remain producers only as `agent_internal` tools.
  They must not re-open as structured handoff/provider-facing tools.

## Phase 2 Exit Interpretation

Phase 2 is complete only when:

- Go and Python loaders validate the same artifact vocabulary and bindings.
- AgentSpec projection kinds match artifact kinds or explicit aliases.
- ToolSpec producer ownership matches artifact owner/gate posture.
- The capability graph can be used by later phases without planner scenario if-else.
