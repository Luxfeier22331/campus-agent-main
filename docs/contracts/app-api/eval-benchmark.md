---
doc_type: contract
truth_scope: eval
owner_boundary: apps/app-api
status: active
created: 2026-04-23
updated: 2026-07-12
---
# Eval Benchmark HTTP

## Boundary

`POST /api/internal/evals/chat/requests` lets trusted eval automation execute
the real app-api command path and receive request/trace correlation plus the
safe execution result. It is not browser-facing and does not bypass
execution-control or the Agent SDK loop.

## Authentication

Required headers:

- `content-type: application/json`;
- `x-app-internal-auth` matching `APP_API_INTERNAL_SHARED_SECRET`;
- `x-eval-user-email`.

Optional `x-eval-*` identity headers may project user id/name, principal type,
major, program, cohort, roles, departments, entitlement groups and retrieval
visibility. Non-ASCII identity values may use `b64:<base64-utf8>`.

## Request

```json
{
  "prompt": "奖学金如何评定？",
  "requestedTool": "knowledge_query"
}
```

`conversationId` and `requestedTool` are optional. `requestedTool` is the only
trusted routing hint and is validated against the runtime registry. Scope,
target, version, corpus, collection and retrieval controls are rejected.

When `knowledge_query` is forced, the SDK still performs the official handoff.
Execution-control injects the active target list, the Knowledge Agent selects
targets, and finalization validates evidence through the same product path.

## Response

Success returns `200`, `x-request-id`, `x-trace-id`, the normal chat `answer`
shape and an eval-only safe `execution` projection. The execution projection may
include status, selected tool, `resolvedTargets[]`, finalized answer, sources,
observability and trace identity.

Raw prompts beyond the admitted request text, provider responses, source
bodies, retrieval backend payloads and auth material are not returned.

## Errors

- Missing or invalid internal auth returns `401 service_credential_required`.
- Unsupported fields or invalid body shape return `422 validation_failed`.
- Runtime errors use the normal correlated app-api error contract.

The route returns command-path correlation directly and does not schedule the
operator projection drain.
