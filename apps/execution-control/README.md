# execution-control

Go-owned internal execution runtime for the Temporal-backed answer path.

`apps/execution-control` owns execution admission, runtime policy, Temporal
command/query/cancel, memory activities, internal query admission, evidence
validation, source projection, sanitized run/step/event projection and internal
runtime observability. It is not a browser-facing product surface.

## Runtime Scope

Current HTTP surface:

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `POST /internal/execution/runs`
- `GET /internal/execution/runs/:runId`
- `GET /internal/execution/runs/:runId/events`
- `GET /internal/execution/runs/:runId/steps`
- `POST /internal/execution/runs/:runId/cancel`
- internal query/tool read-model endpoints protected by
  `x-execution-query-auth`

Temporal owns workflow/activity scheduling. The current online path is:

```text
app-api -> execution-control -> Temporal -> context.memory_recall
-> one agent activity running the complete OpenAI Agents SDK loop
-> finalization.write -> context.memory_append -> app-api projection reads
```

The primary agent selects admitted function tools or official handoff targets
inside that SDK run. For governed knowledge questions it uses the SDK
`handoff()` API to enter the Knowledge Agent. The Knowledge Agent can call only
the internal `knowledge_search` tool.
Execution-control admits target/access requests, runs embedding and Qdrant
dense/sparse RRF lookup, projects bounded evidence, validates terminal evidence refs, generates
sources and writes finalization. It does not run a separate knowledge queue,
RAG graph, synthesis provider or replanning loop.

## Boundaries

- `app-api` remains the browser-facing submit/status/event surface.
- `agent-runtime` owns the only model-facing agent/tool loop and calls
  execution-control internal query endpoints from SDK tools.
- The whole primary/Knowledge Agent SDK run executes inside
  `activity-worker-agent`; only workflow, core and agent worker pools exist.
- App-api persists and streams the finalized answer and sources; it does not
  rewrite answer text.
- Python supervisor/handoff serving is retired and must not be reintroduced.
- Function tools and handoffs are closed by default and opened only through the
  runtime registry and strict schema artifacts after product/eval admission.
- Hindsight owns personal memory storage/extraction/recall; execution-control
  only consumes bounded memory recall packets and writes sanitized projections.

## References

- current topology: `docs/architecture/current.md`
- execution agent layer: `docs/architecture/system/execution-agent-layer.md`
- durable runtime: `docs/architecture/system/durable-runtime.md`
- tool runtime: `docs/architecture/system/tool-runtime.md`
- tool routing/admission: `docs/architecture/system/tool-routing.md`
- memory plane: `docs/architecture/system/memory-plane.md`
- local runtime smoke: `docs/runbooks/local-runtime-smoke.md`
- staging operations: `docs/runbooks/execution-ops.md`
- Temporal operations: `docs/runbooks/temporal-self-host-operations.md`

## Local Development

Requirements:

- Go `1.26.x`
- `golangci-lint v2.11.4`

Common commands:

```bash
pnpm go:check
pnpm repo:static
```

Runtime env, provider projection, Hindsight projection, Qdrant, Temporal and
run projection store setup are operational concerns documented in the runbooks
above. Do not add inactive compatibility settings or local secret values to
this README.
