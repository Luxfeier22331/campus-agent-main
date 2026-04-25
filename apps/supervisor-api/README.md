# supervisor-api

`apps/supervisor-api` is the Go-owned execution runtime for the Docker-side
supervisor service.

Current status:

- Implements the Docker-side HTTP runtime for `GET /healthz`, `GET /readyz`,
  `GET /metrics`, `POST /api/v1/answer`, `POST /api/v1/answer/stream`, and
  `POST /internal/execution/cancel`.
- Owns request body limits, JSON parsing, `bearer` / `trusted-worker` caller
  auth, strict environment parsing, request projection, fail-closed bridge
  handling, lifecycle registry, explicit cancel, and global / per-lane execution
  admission.
- Infers deterministic effective `requested_capability` and execution lane for
  common navigation, campus-services, notice, and knowledge requests when the
  caller omits an explicit capability.
- Projects the external execution request into private bridge v6
  `SupervisorRequest -> AgentRequest -> AgentResponse` JSON for
  semantic delegate requests, then finalizes the bridge `AgentResponse`
  into the public `SupervisorResponse` envelope in Go. Non-delegate terminal
  decisions and opened deterministic structured requests complete in Go without
  calling the Python orchestration bridge.
- Aggregates Python worker readiness into Go-owned `/readyz`, while keeping Go
  transport admission as the published `transport_runtime`.
- Exposes Go-owned Prometheus-style runtime counters at `/metrics`.
- Keeps metrics route labels bounded; unknown routes are reported as
  `/__unknown__` instead of raw URL paths.
- Emits answer-path structured logs with `trace_id`, `status_code`, `outcome`,
  and `duration_ms`, without logging raw `user_goal`.
- Emits allowlisted execution audit events to `app-api` internal ingest when
  configured; this is batched, retried, optionally spooled, best-effort, and
  never blocks answer requests.
- Propagates explicit cancel to the Python private bridge through
  `/internal/bridge/execution/cancel`; Python records the cooperative cancel
  signal and the semantic orchestration path checks it around routing, RAG
  prompt execution and agent delegation. Provider / prompt calls that are
  already in-flight still are not hard-aborted.
- Owns the bridge circuit breaker for Python bridge transport / protocol
  failures; open circuits short-circuit answer execution with
  `503 supervisor_bridge_circuit_open` and degrade `/readyz`.
- Bounds Python bridge response bodies with
  `SUPERVISOR_AGENT_WORKER_RESPONSE_LIMIT_BYTES`.
- Owns deterministic delegate handoff planning in `internal/structuredplanning`,
  including `rag-agent` `rag_request` payload projection and structured
  campus-services / notice payload projection; `internal/execution` only adapts
  planner output into bridge v6 `runtime_decisions`.
- Bridge v6 handoff carries the full `AgentRequest` envelope under
  `runtime_decisions.handoff.agent_request`; the older handoff-only payload
  fragment is not an active compatibility path.
- Owns deterministic runtime policy in `internal/runtimepolicy`, including
  product scope gate, high-risk approval / reject gate, context follow-up
  preflight, query-enabled scope admission, and structured tool policy version.
  Runtime policy decisions are projected into bridge v6 and summarized in
  Go-owned metrics, OTel attributes, and execution audit events without
  including raw user text.
- Owns non-delegate terminal envelopes for clarify, approval-required,
  out-of-scope and rejected decisions. Non-stream and lifecycle SSE answer
  routes execute those terminal envelopes directly in Go; Python bridge only
  receives delegate handoff requests.
- Owns the structured tool policy summary. Python only validates that the
  preplanned payload kind matches the Go-provided `allowed_tools`.
- Hosts the gate-closed structured query runtime foundation for campus services
  and notice capabilities. `service_status_lookup` can read a configured file
  projection fixture for deterministic runtime tests; `transport_schedule_lookup`
  can resolve projection-backed schedule snapshot metadata, route clarification,
  departures, service windows, timetables, and temporary suspension summaries;
  `service_guide_lookup` reads a dedicated mounted service-guide projection for
  source-linked guide sections, materials, entries, hours, contacts, eligibility
  notes, ambiguity and fail-close outcomes; `campus_notice_discover` /
  `campus_notice_get` read the internal notice PG read model and S3-compatible
  derived canonical bodies. This still does not open `campus_services` or
  `notice` product serving.
- When `campus_services` or `notice` is explicitly opened, non-stream
  `/api/v1/answer` and lifecycle SSE `/api/v1/answer/stream` can execute those
  deterministic structured payloads directly in Go and shape a supervisor-style
  response without calling the Python bridge.
- Owns bounded FIFO execution admission with queue full / lane queue full /
  queue timeout / lane queue timeout / draining outcomes, `Retry-After` hints,
  and graceful shutdown drain.
- Repo-local `Phase 1-7` implementation is in place:
  cancellation semantics, per-lane admission, Go-owned observability, local
  compose smoke, Python parity rerun, and runback docs are all landed.
- Repo-local `Phase 8-12` implementation is in place:
  cooperative Python bridge cancel signaling, the structured query runtime
  foundation, and the transport schedule query kernel are landed without
  opening `campus_services` product serving.
- Repo-local bridge hardening is in place: Python cancellation is observed by
  the semantic runtime checkpoints, bridge circuit state is exposed in
  `/readyz` / `/metrics`, and execution audit failure events carry measured
  bridge duration.
- Repo-local lifecycle streaming is in place: `/api/v1/answer/stream` emits SSE
  lifecycle events (`execution.started`, `execution.queued`,
  `execution.running`, terminal completed / failed / cancelled) and does not
  stream model token deltas.

Current admission boundary:

- `SUPERVISOR_API_MAX_CONCURRENT_ANSWERS` caps executions that can enter the
  Python bridge concurrently.
- `SUPERVISOR_API_QUEUE_CAPACITY` is a short in-process burst buffer, not a
  durable task queue.
- `SUPERVISOR_API_QUEUE_TIMEOUT_MS` bounds how long an answer request can wait
  before returning `503 transport_queue_timeout`.
- Full queues return `503 transport_queue_full` with `retryable=true` and
  `Retry-After`.
- Lane budgets are configured with
  `SUPERVISOR_API_LANE_<LANE>_MAX_CONCURRENT`,
  `SUPERVISOR_API_LANE_<LANE>_QUEUE_CAPACITY`, and
  `SUPERVISOR_API_LANE_<LANE>_QUEUE_TIMEOUT_MS`.
- Current lanes are `rag`, `navigation`, `campus_services`, `notice`, and
  `default`; unset lane budgets inherit the global budget.
- `active_answers == max_concurrent_answers` does not by itself make `/readyz`
  degraded if the queue can still accept short bursts.
- `SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD` defaults to `5` consecutive
  bridge transport / protocol failures before opening the circuit.
- `SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS` defaults to `10000`; while open, answer
  requests fail fast instead of occupying execution slots on a known-bad bridge.
- `SUPERVISOR_API_QUERY_SERVING_SCOPES_PATH` points at the Go-owned
  query-serving scope allowlist. When unset, local repo runs discover
  `configs/runtime/query-serving-scopes.v1.json` from the repo root; if no
  policy file is found, knowledge scoped requests fail closed. The Docker image
  sets this env var to `/etc/campus-agent/query-serving-scopes.v1.json`.

Current cancellation boundary:

- Go `apps/supervisor-api` stops waiting on the Python bridge when the upstream
  HTTP client disconnects or the runtime timeout fires.
- `POST /internal/execution/cancel` accepts `{ "request_id": "..." }` with
  `x-worker-origin-auth` and marks the active Go execution as
  `cancel_requested`.
- Go `apps/supervisor-api` also sends a best-effort cooperative cancel to the
  Python bridge. The bridge marks active request ids as `cancel_requested`, and
  default supervisor orchestration stops at deterministic checkpoints. This
  does not guarantee provider / prompt executor mid-flight termination once a
  blocking provider request is already running.

Current structured query runtime boundary:

- Internal query routes require `x-supervisor-query-auth`.
- Structured product serving gates for `campus_services` and `notice` are
  closed by default. `SUPERVISOR_API_OPEN_CAPABILITIES` is the Go-owned allowlist
  for opening those capabilities after eval / product admission evidence exists.
  It only accepts
  `campus_services`, `notice`, or `campus_services,notice`; wildcard values such
  as `*` or `all` are rejected.
- `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET` enables internal query auth.
- `SUPERVISOR_STRUCTURED_QUERY_PROJECTION_PATH` points at a dev/test file
  projection bundle for the current service status / transport foundation slice
  and remains the fallback service-guide path for local fixtures.
- `SUPERVISOR_SERVICE_GUIDE_PROJECTION_PATH` points at the mounted readonly
  `campus_services/service_guide` current projection used by
  `service_guide_lookup`.
- `SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339` pins trusted runtime time
  for deterministic tests; production should normally omit it.
- `SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS` bounds internal query execution.
- `SUPERVISOR_NOTICE_BODY_LIMIT_BYTES` bounds canonical notice body reads from
  object storage.
- `INTERNAL_NOTICE_READ_MODEL_DATABASE_URL` configures the notice read-model PG
  connection; `CAMPUS_SHARED_POSTGRES_URL` is the fallback.
- `INTERNAL_NOTICE_READ_MODEL_TABLE` defaults to
  `ingestion_projection.internal_notice_read_model`.
- `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_DERIVED_ACCESS_KEY` /
  `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_DERIVED_SECRET_KEY` /
  `OBJECT_STORE_SECRET_KEY`, `OBJECT_STORE_REGION`, and
  `OBJECT_STORE_BUCKET_DERIVED` configure notice canonical body reads from the
  S3-compatible derived bucket.
- The runtime is not browser-facing and not an `app-api` product surface. It
  does not open `place_lookup`; navigation / map-backed place lookup remains
  deferred until the map product rollout.
- Python orchestration can consume this seam only when
  `SUPERVISOR_STRUCTURED_QUERY_BASE_URL` and
  `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET` are configured in the
  `supervisor-api` worker container.
- The Go direct structured answer path uses the same projection-backed query
  runtime internally after the structured capability opening gate admits the
  request; this applies to both non-stream answer and lifecycle SSE answer
  routes.
- `/readyz` reports `capability_gates` so operators can see whether
  `campus_services` / `notice` are still closed, and `/metrics` reports
  capability gate open / closed decisions.
- `/readyz` degrades if `campus_services` or `notice` is opened before its
  required structured runtime dependencies are configured.

Current observability boundary:

- `/metrics` is an internal runtime surface, not part of the `app-api` contract.
- Current Go-owned counters distinguish admission decisions, queue depth,
  queue wait, lifecycle final states, bridge latency, bridge timeout /
  unavailability, cooperative bridge cancel outcomes, structured query
  outcomes, structured capability gate decisions, bounded runtime policy
  decision summaries, bridge circuit state, bridge circuit open / reject totals,
  and aggregate request outcomes.
- `SUPERVISOR_API_METRICS_BEARER_TOKEN` can protect `/metrics` when the surface
  is reachable outside a trusted local network; local development leaves it
  empty by default.
- OTel trace export is disabled by default. When enabled,
  `SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT` must be configured; telemetry
  export is fail-open for answer requests and surfaces exported / dropped /
  failed / sample-ratio / last-error state in `/readyz` and `/metrics`.
- Execution audit backflow is disabled by default. When enabled, Go
  `apps/supervisor-api` sends only safe runtime event summaries for admission
  rejection, cancel, bridge failure, and timeout to `app-api`; it never includes
  raw `user_goal`, prompt, answer, transcript, auth material, retrieval payload,
  or provider response. The runtime decision summary is limited to low-cardinality
  labels such as scope gate, policy gate, context preflight, routing next action,
  planning outcome, selected target/tool, terminal outcome, and fail-close
  reason.
- `/readyz` reports `execution_audit_runtime`, and `/metrics` reports emitted,
  dropped, failed, retry, spool, queue depth, batch size, enabled, and
  configured counters/gauges. `/readyz` degrades when execution audit is enabled
  but missing its ingest URL or shared secret.

Requirements:

- Go `1.26.x`
- `golangci-lint v2.11.4` for local static checks
- Docker for container smoke checks

Official local install for `golangci-lint`:

```bash
curl -sSfL https://golangci-lint.run/install.sh | \
  sh -s -- -b "$(go env GOPATH)/bin" v2.11.4
export PATH="$PATH:$(go env GOPATH)/bin"
```

Key env:

```bash
export API_AUTH_MODE=trusted-worker
export API_WORKER_SHARED_SECRET=worker-secret
export SUPERVISOR_API_MAX_CONCURRENT_ANSWERS=8
export SUPERVISOR_API_QUEUE_CAPACITY=24
export SUPERVISOR_API_QUEUE_TIMEOUT_MS=3000
export SUPERVISOR_API_LANE_RAG_MAX_CONCURRENT=6
export SUPERVISOR_API_LANE_RAG_QUEUE_CAPACITY=12
export SUPERVISOR_API_LANE_RAG_QUEUE_TIMEOUT_MS=3000
export SUPERVISOR_API_LANE_NAVIGATION_MAX_CONCURRENT=2
export SUPERVISOR_API_LANE_NAVIGATION_QUEUE_CAPACITY=4
export SUPERVISOR_API_LANE_NAVIGATION_QUEUE_TIMEOUT_MS=1500
export SUPERVISOR_API_OPEN_CAPABILITIES=
export SUPERVISOR_API_OTEL_ENABLED=false
export SUPERVISOR_API_OTEL_SAMPLE_RATIO=1
export SUPERVISOR_API_OTEL_ALLOWED_ATTRIBUTES_VERSION=supervisor-api-otel-attrs-v1
export SUPERVISOR_API_EXECUTION_AUDIT_ENABLED=false
export SUPERVISOR_API_EXECUTION_AUDIT_URL=http://127.0.0.1:8787/api/internal/execution/audit-events
export SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET=app-api-internal-secret
export SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS=500
export SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY=128
export SUPERVISOR_API_EXECUTION_AUDIT_BATCH_SIZE=10
export SUPERVISOR_API_EXECUTION_AUDIT_FLUSH_MS=1000
export SUPERVISOR_API_EXECUTION_AUDIT_RETRY_MAX_ATTEMPTS=3
export SUPERVISOR_API_EXECUTION_AUDIT_RETRY_BASE_MS=100
export SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_DIR=
export SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_MAX_BYTES=10485760
export SUPERVISOR_API_REQUEST_TIMEOUT_MS=45000
export SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD=5
export SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS=10000
export SUPERVISOR_API_QUERY_SERVING_SCOPES_PATH=
export SUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:18081
export SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
export SUPERVISOR_AGENT_WORKER_TIMEOUT_MS=35000
export SUPERVISOR_AGENT_WORKER_CANCEL_TIMEOUT_MS=500
export SUPERVISOR_AGENT_WORKER_RESPONSE_LIMIT_BYTES=1048576
export SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET=query-secret
export SUPERVISOR_STRUCTURED_QUERY_PROJECTION_PATH=
export SUPERVISOR_SERVICE_GUIDE_PROJECTION_PATH=
export SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339=
export SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS=1000
export INTERNAL_NOTICE_READ_MODEL_DATABASE_URL=
export INTERNAL_NOTICE_READ_MODEL_TABLE=ingestion_projection.internal_notice_read_model
export OBJECT_STORE_ENDPOINT=
export OBJECT_STORE_DERIVED_ACCESS_KEY=
export OBJECT_STORE_DERIVED_SECRET_KEY=
export OBJECT_STORE_REGION=us-east-1
export OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived
export SUPERVISOR_NOTICE_BODY_LIMIT_BYTES=1048576
```

Staging lifecycle derives execution audit URL and shared secret from
`SUPERVISOR_API_STAGING_APP_API_BASE_URL` and `APP_API_INTERNAL_SHARED_SECRET`
when the explicit `SUPERVISOR_API_EXECUTION_AUDIT_*` variables are absent.
Generic local compose keeps execution audit disabled unless explicitly enabled.

Local verification:

```bash
pnpm go:static:check
pnpm go:check
```

Docker build:

```bash
docker build -f apps/supervisor-api/Dockerfile -t campus-supervisor-api:local .
```

Docker smoke:

```bash
docker run --rm -p 18080:8000 campus-supervisor-api:local
```

Local two-container smoke:

```bash
docker compose -f infra/local/docker-compose.supervisor-runtime.yml up --build
```

Expected behavior:

```bash
curl http://127.0.0.1:18080/healthz
curl -i http://127.0.0.1:18080/readyz
curl http://127.0.0.1:18080/metrics
curl -i -H 'content-type: application/json' \
  -H 'x-worker-origin-auth: worker-secret' \
  -d @<(cat <<'JSON'
{
  "request_id": "req-local-smoke-001",
  "user_goal": "hello",
  "context": {
    "actor": {
      "user_id": "student-001"
    },
    "authorization": {
      "retrieval_filter": {
        "entitlement_groups": [],
        "visibility_level": "public",
        "policy_projection_version": "phase1-authorization-projection-v1"
      }
    }
  }
}
JSON
) \
  http://127.0.0.1:18080/api/v1/answer
```

Detailed local smoke / cutover / runback steps:

- [supervisor-api-local-runtime-smoke.md](../../docs/runbooks/supervisor-api-local-runtime-smoke.md)
