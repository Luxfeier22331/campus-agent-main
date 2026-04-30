---
doc_type: inventory
phase: phase-01-current-tool-surface-inventory
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Tool Surface Inventory

## Current Tool Families

| Tool | Runtime owner | Agent target | Payload kind | Payload DTO | Result DTO | Backend boundary | Serving posture |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `service_status_lookup` | Go admission + Python thin adapter | `campus-services-agent` | `service_status_lookup` | `ServiceStatusLookupPayload` | `ServiceStatusLookupResult` | internal structured query service | open structured runtime |
| `service_guide_lookup` | Go admission + Python thin adapter | `campus-services-agent` | `service_guide_lookup` | `ServiceGuideLookupPayload` | `ServiceGuideLookupResult` | internal structured query service | open structured runtime |
| `transport_schedule_lookup` | Go admission + Python thin adapter | `campus-services-agent` | `transport_schedule_lookup` | `TransportScheduleLookupPayload` | `TransportScheduleLookupResult` | internal structured query service | open structured runtime |
| `contact_directory_lookup` | Go admission + Python thin adapter | `campus-services-agent` | `contact_directory_lookup` | `ContactDirectoryLookupPayload` | `ContactDirectoryLookupResult` | internal structured query service | later-wave / guarded structured runtime |
| `campus_notice_discover` | Go admission + Python thin adapter | `notice-agent` | `campus_notice_discover` | `CampusNoticeDiscoverPayload` | `CampusNoticeDiscoverResult` | internal structured query service | open structured runtime |
| `campus_notice_get` | Go admission + Python thin adapter | `notice-agent` | `campus_notice_get` | `CampusNoticeGetPayload` | `CampusNoticeGetResult` | internal structured query service | open structured runtime |
| `retrieval.query` | domain-agent internal retrieval step | `rag-agent` | `rag_request` | `RagRequestPayload` | `RagResultPayload` / evidence bundle | `retrieval-core` | internal tool label, not Go preplanned tool adapter |

## Go Runtime Policy Surface

- `apps/supervisor-api/internal/runtimepolicy/tools.go` owns the current
  `allowedToolsByTarget` allowlist.
- `AllowedToolsForTarget("rag-agent")` and
  `AllowedToolsForTarget("navigation-agent")` intentionally return empty tool
  lists.
- `AllowedToolsForPayloadKind(target, payloadKind)` only returns the single
  payload-kind tool when the target allowlist contains that exact tool.
- `apps/supervisor-api/internal/structuredplanning/planner.go` consumes runtime
  policy helpers when building deterministic handoffs.

## Python Worker / Agent Surface

- `apps/supervisor-agent-worker/.../bridge_v6_parser.py` requires
  `runtime_decisions.handoff.allowed_tools` to match
  `agent_request.allowed_tools`.
- `apps/supervisor-agent-worker/.../bridge_payload_codecs.py` maps Go payload
  kinds into contract DTOs.
- `packages/campus-services-agent/.../tool_adapter.py` dispatches structured
  campus service payloads and rejects tools not present in
  `AgentRequest.allowed_tools`.
- `packages/notice-agent/.../tool_adapter.py` dispatches notice payloads and
  rejects tools not present in `AgentRequest.allowed_tools`.
- `packages/rag-agent` labels retrieval observability as `retrieval.query`, but
  retrieval remains an internal domain-agent step rather than a Go structured
  tool handoff.

## Contract Surface

- `packages/contracts/src/campus_contracts/models_runtime.py` defines
  `AgentRequest.allowed_tools`, `AgentObservability.selected_tool`,
  `WorkflowTraceSummary.selected_tools`, `tool_argument_summary`, and
  `tool_call_summaries`.
- `packages/contracts/src/campus_contracts/models_tools.py` defines the
  structured runtime payload/result DTOs for service status, service guide,
  transport schedule, contact directory, notice discover, and notice get.
- Contract models are provider-agnostic; provider-native function schema must
  be generated as adapter artifact, not introduced as contract DTOs.

## Eval / Trace Surface

- `packages/evals/fixtures/tool_family_denominators.v1.json` is the current
  tool-family denominator artifact.
- `packages/evals/fixtures/workflow_trace_gate_cases.v1.json` and
  `tests/evals/workflow_trace_gate_suite.py` cover selected tool order,
  argument summaries, and raw-trace redaction.
- `packages/evals/src/campus_evals/intent_scenarios.py` carries expected
  `allowed_tools` for synthetic intent cases.
- `tests/evals/tool_family_denominator_suite.py` expects all seven current tool
  labels, including `retrieval.query`.

## Classification

| Class | Members | Governance requirement |
| --- | --- | --- |
| Go deterministic structured tools | `service_status_lookup`, `service_guide_lookup`, `transport_schedule_lookup`, `contact_directory_lookup`, `campus_notice_discover`, `campus_notice_get` | ToolSpec-backed admission, strict target/payload/tool mapping, lifecycle projection |
| Domain-agent internal retrieval tool | `retrieval.query` | Visible in eval/observability denominator, not exposed as provider function schema through Go preplanning |
| Closed / future tools | `place_lookup`, external web/MCP/browser tools, state-changing tools | Explicitly absent from ToolSpec active read-only registry until a future workstream opens them |
