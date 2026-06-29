# execution-control

Go-owned internal execution runtime for the Temporal-backed answer path.

`apps/execution-control` owns execution admission, runtime policy, Temporal
command/query/cancel, sanitized run/step/event projection, typed tool dispatch,
Go RAG runtime, provider usage/cost projection and internal runtime
observability. It is not a browser-facing product surface.

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
-> agent.primary -> admitted tool/RAG branch or direct finalization
-> finalization.write -> app-api projection reads
```

## Boundaries

- `app-api` remains the browser-facing submit/status/event surface.
- `agent-runtime` owns model-facing Agents SDK execution and calls
  execution-control internal query endpoints for typed tools.
- Python supervisor/handoff serving is retired and must not be reintroduced.
- Structured tools are closed by default and opened only through the runtime
  profile allowlist after product/eval admission.
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
- Docker for compose smoke checks

Common commands:

```bash
pnpm go:check
pnpm repo:static
infra/local/start-execution-control-runtime.sh up -d --build --remove-orphans
infra/local/smoke-execution-control-runtime.sh closed_gate
```

Runtime env, provider projection, Hindsight projection, Qdrant, Temporal and
run projection store setup are operational concerns documented in the runbooks
above. Do not add retired Python bridge env, fallback handoff env or local
secret values to this README.
