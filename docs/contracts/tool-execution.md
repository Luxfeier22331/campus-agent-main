---
doc_type: contract
truth_scope: execution
owner_boundary: apps/execution-control
status: active
created: 2026-03-28
updated: 2026-07-12
---
# Execution Contract

## Boundary

This document explains the private command/query contract between
`apps/app-api` and `apps/execution-control`. The executable source is
`schemas/tool-execution.openapi.yaml`; generated TypeScript and Go types must
match it.

- App-api owns browser auth, conversation truth and browser transport.
- Execution-control owns admission, Temporal lifecycle, internal query policy,
  finalization and sanitized projection.
- Agent-runtime owns the complete OpenAI Agents SDK loop inside one Temporal
  Agent Activity.
- Browsers never call this contract directly.

## Endpoints

- `POST /internal/execution/runs`
- `GET /internal/execution/runs/:runId`
- `GET /internal/execution/runs/:runId/events`
- `GET /internal/execution/runs/:runId/steps`
- `POST /internal/execution/runs/:runId/cancel`

All private wire bodies use strict `snake_case` JSON.

## Run Creation

The run envelope carries immutable run, conversation, turn, request, owner,
surface and trace identity. Its only metadata field is `execution_payload`.
Nested conversation, request and trace ids must match the envelope.

The active payload is `tool_execution_v2` with response contract
`execution_finalization_response_v3`:

```json
{
  "execution_contract_version": "tool_execution_v2",
  "response_contract": "execution_finalization_response_v3",
  "user_goal": "学生手册请假制度怎么规定？",
  "conversation_id": "conv_01",
  "request_id": "req_01",
  "safety_identifier": null,
  "trace": { "trace_id": "trace_01" },
  "context": {
    "actor": {},
    "authorization": { "retrieval_filter": {} }
  }
}
```

`tenant_id` and `requested_tool` are optional. Ordinary product chat omits
`requested_tool`; the primary agent chooses from the admitted model-visible
tools. Trusted internal eval/debug requests may constrain SDK tool choice, but
the hint never supplies a knowledge target or retrieval controls.

The caller does not send scope, version query, corpus, collection, top-k,
provider, vector-store or task-queue fields.

## Tool Exposure

`configs/runtime/tools.v5.json` and
`configs/runtime/tool-function-schemas.v2.json` are runtime tool truth.

- `knowledge_query` is a model-visible SDK handoff with `{query_text}`.
- `transport_schedule_lookup` is a model-visible internal-query function tool.
- `knowledge_search` is internal-only to the Knowledge Agent with
  `{query_text, target, include_history}`.

Execution-control injects targets from
`configs/runtime/query-serving-targets.v1.json`. App-api does not choose or
validate a target.

## Temporal And Finalization

`ToolExecutionWorkflow` runs Memory Recall, one complete Agent Activity,
Finalization and Memory Append. SDK handoffs and function calls do not create
additional Temporal activities.

`ExecutionFinalizationResponse` contains selected tool, status, answer,
follow-up, confidence, result, error, `resolved_targets[]`, session update and
trace id. Optional fields include observability, workflow trace summary and
stage timing. It does not return sink refs or per-request telemetry controls.

For knowledge answers, execution-control validates every terminal evidence ref
against completed search projections and derives `result.sources` plus
`resolved_targets[]`. It does not call a model or rewrite answer text.

## Projection And Strictness

Temporal history is execution truth. PostgreSQL stores sanitized run, event,
step, attempt and result projections. App-api converts those projections to SSE
and product responses without recreating execution state.

- Unknown fields and camel-case private wire fields are rejected.
- Generated TS and Go artifacts must match OpenAPI.
- Tool and target admission remains server-owned after schema validation.
- There is no fallback parser, alias loader or dual request shape.

## Verification

Use `pnpm ci:contracts`, `pnpm go:check` and the app-api typecheck/test lanes
listed in `../reference/testing-and-verification-lanes.md`.
