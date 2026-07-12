---
doc_type: contract
truth_scope: execution
owner_boundary: apps/execution-control
status: active
created: 2026-03-28
updated: 2026-07-11
---
# Execution Contract

## Boundary

This document defines the private command/query contract between
`apps/app-api` and `apps/execution-control`.

- `app-api` owns browser auth, session, principal mapping, conversation truth
  and browser transport.
- `execution-control` owns execution admission, runtime-visible tools,
  query-serving scope admission, four-phase Temporal dispatch, internal query,
  evidence/source validation and finalization projection.
- `agent-runtime` owns the complete OpenAI Agents SDK agent/tool loop inside one
  Temporal Agent Activity.
- `app-api` persists and streams finalized answer text and sources; it does not
  rewrite answer text.
- Browsers do not call this contract directly.
- Temporal history is execution truth. PostgreSQL stores sanitized run, event,
  step, attempt and result projections.

Related documents:

- product runtime: `../architecture/system/product-runtime.md`
- tool routing: `../architecture/system/tool-routing.md`
- durable runtime: `durable-runtime.md`
- tool trajectory: `tool-trajectory.md`
- primary-agent knowledge routing: `../decisions/adr-0071-primary-agent-knowledge-tool-routing.md`

## Canonical Sources

- `schemas/tool-execution.openapi.yaml` is the OpenAPI 3.1.1 and JSON Schema
  2020-12 source of truth.
- `packages/contracts/scripts/generate_tool_execution_contracts.ts` generates
  the active TS and Go wire types.
- `apps/app-api/src/modules/integration/generated/tool-execution-contract.ts`
  is the app-api consumer artifact.
- `apps/execution-control/internal/contracts/tool_execution_contract.go` is the
  execution-control parser artifact.
- `packages/contracts/fixtures/tool_execution_contract/` contains the shared
  valid and invalid wire fixtures.

## Endpoints

- `POST /internal/execution/runs`
- `GET /internal/execution/runs/:runId`
- `GET /internal/execution/runs/:runId/events`
- `GET /internal/execution/runs/:runId/steps`
- `POST /internal/execution/runs/:runId/cancel`
- `GET /healthz`
- `GET /readyz`

All request and response bodies on this seam use canonical `snake_case` JSON.

## Transport

Deployed Worker environments call execution-control through the Cloudflare
private binding `EXECUTION_CONTROL_PRIVATE.fetch` and use
`EXECUTION_CONTROL_PRIVATE_ORIGIN` as the request origin. They do not depend on
a public execution-control ingress. `EXECUTION_CONTROL_BASE_URL` is reserved for
local development where the private binding is unavailable.

Transport selection does not change the request, response or internal caller
authentication contract.

## Run Creation

`POST /internal/execution/runs` accepts one strict run envelope:

```json
{
  "run_id": "run_01",
  "conversation_id": "conv_01",
  "turn_id": "turn_01",
  "request_id": "req_01",
  "trace_id": "trace_01",
  "owner_user_id": "user_01",
  "surface": "campus_web",
  "runtime_versions": {
    "caller": "app-api@revision"
  },
  "metadata": {
    "execution_payload": {
      "execution_contract_version": "tool_execution_v1",
      "response_contract": "execution_finalization_response_v2",
      "user_goal": "学生手册请假制度怎么规定？",
      "conversation_id": "conv_01",
      "request_id": "req_01",
      "safety_identifier": null,
      "tenant_id": "tenant-main",
      "trace": {
        "trace_id": "trace_01"
      },
      "context": {},
      "version_query": {
        "mode": "current"
      }
    }
  }
}
```

The caller does not provide `task_queue`, `selected_tool` or a second
top-level `requested_tool`. Execution-control derives the workflow task queue
from runtime config and reads any trusted hint from `metadata.execution_payload`.

The nested `request_id`, `conversation_id` and `trace.trace_id` must match the
run envelope. `metadata` accepts only `execution_payload`.

## Execution Payload

Required fields:

- `execution_contract_version`
- `response_contract`
- `user_goal`
- `conversation_id`
- `request_id`
- `trace`
- `context`
- `version_query`

Optional fields:

- `tenant_id`
- `safety_identifier`
- `requested_tool`
- `scope`

Ordinary public chat does not populate `requested_tool` or `scope`. The primary
agent receives the runtime-visible tool set and decides whether to answer,
clarify or call a tool.

The trusted internal eval route may provide an explicit tool hint. For
`requested_tool=knowledge_query`, `scope` is required. Any other tool with a
`scope` is invalid. Execution-control still validates the requested tool against
the runtime registry; schema validity does not grant tool or scope admission.

`context.actor` carries the sanitized principal projection. There is no
duplicate top-level actor. Raw auth tokens, cookies, raw memory payloads and
provider-native data are forbidden.

## Tool Exposure

`configs/runtime/tools.v4.json` is the runtime tool registry. The current
model-visible tools are:

- `knowledge_query`
- `transport_schedule_lookup`

`knowledge_query` maps to the official OpenAI Agents SDK `handoff()` targeting
the Knowledge Agent. It does not return an acknowledgement for execution-control
to execute later.

`knowledge_search` is `internal_only` and available only to the Knowledge Agent.
It calls `/internal/query/knowledge/search`; execution-control validates the
run-bound query, scope and version, performs embedding/Qdrant/optional rerank,
and returns bounded evidence.

`configs/runtime/query-serving-scopes.v3.json` maps model-facing scope ids to
internal corpus/collection ownership and allowed version modes. Callers never
send corpus, collection, top-k, vector-store details or retrieval planner
inputs.

## Agent Activity

`ToolExecutionWorkflow` has four ordered phases:

1. Memory Recall;
1. one Agent Activity containing the complete primary/Knowledge Agent SDK run;
1. Finalization;
1. Memory Append.

SDK handoffs and function-tool calls remain inside the Agent Activity. The
workflow has no separate knowledge, tool, retrieval or answer-generation
activity. Worker pools are limited to workflow, core and agent.

## Run Projection

Run responses include execution-owned projection fields such as:

- lifecycle status and timestamps
- `requested_tool` and `selected_tool`
- execution-owned `task_queue`
- terminal and fail-close reasons
- workflow and final response references

These are output/projection facts. Their presence in a response does not make
them caller-owned run-create fields.

## Finalization

`ExecutionFinalizationResponse` requires:

- `selected_tool`
- `status`
- `answer_text`
- `follow_up_question`
- `confidence`
- `result`
- `error`
- `resolved_scope`
- `session_update`
- `trace_id`

Optional operator-safe fields include `observability`,
`workflow_trace_summary` and `stage_timing`.

For evidence-backed knowledge answers, `result.sources` is generated by
execution-control after validating terminal evidence refs against projected
`knowledge_search` results. Finalization rejects forged or missing refs. It
does not call a model or rewrite `answer_text`.

`resolved_scope` is the admitted model-facing knowledge scope or `null`.
`session_update` is `null` or a strict list of confirmed curriculum slots:

- `curriculum_program`
- `curriculum_program_family`
- `curriculum_semester`

Terminal errors use `{code, message, retryable}`. Timeout, cancellation,
dependency failure and admission rejection cannot be encoded as successful
answers.

## Streaming And Projection

Execution-control writes sanitized run events and step trajectories. App-api
turns those projections into browser SSE events and product responses without
rewriting finalized answer text.

- Browser streams do not own execution state.
- Raw provider output, raw tool arguments, raw evidence bodies and auth material
  do not enter product projections.
- Langfuse/OpenTelemetry correlation may be referenced through sanitized trace
  ids and approved debug refs; external traces do not replace canonical run
  projections.

## Strictness

- Unknown fields are rejected at the run and execution-payload boundaries.
- Camel-case fields are invalid on the private wire.
- Generated TS and Go artifacts must match the OpenAPI source.
- Runtime tool and scope admission happens in execution-control even when the
  request is structurally valid.
- No fallback parser, alias loader, inferred scope or dual request shape is
  supported.

## Verification

Use the contract, Go and app-api lanes defined in
`../reference/testing-and-verification-lanes.md`. The relevant local commands
are `pnpm contracts:check`, `pnpm ci:contracts`, `pnpm go:check`,
`pnpm --dir apps/app-api typecheck` and `pnpm --dir apps/app-api test:node`.
