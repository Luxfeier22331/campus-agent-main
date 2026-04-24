# go-shell

`apps/go-shell` is the Go execution shell for the Docker-side supervisor runtime.

Current status:

- Implements the Docker-side HTTP shell for `GET /healthz`, `GET /readyz`,
  `GET /metrics`, `POST /api/v1/answer`, and
  `POST /internal/execution/cancel`.
- Owns request body limits, JSON parsing, `bearer` / `trusted-worker` caller
  auth, request projection, fail-closed bridge handling, lifecycle registry,
  explicit cancel, and global / per-lane execution admission.
- Projects the external execution request into private
  `SupervisorRequest -> SupervisorResponse` JSON and calls the Python
  orchestration bridge at `/internal/bridge/*`.
- Aggregates Python worker readiness into shell-owned `/readyz`, while keeping
  Go transport admission as the published `transport_runtime`.
- Exposes shell-owned Prometheus-style runtime counters at `/metrics`.
- Emits answer-path structured logs with `trace_id`, `status_code`, `outcome`,
  and `duration_ms`, without logging raw `user_goal`.
- Emits allowlisted execution audit events to `app-api` internal ingest when
  configured; this is best-effort and never blocks answer requests.
- Propagates explicit cancel to the Python private bridge through
  `/internal/bridge/execution/cancel`; Python currently records the cooperative
  cancel signal, while deeper provider / prompt mid-flight stop remains a
  later semantic-runtime task.
- Hosts the gate-closed structured query runtime foundation for campus services
  and notice capabilities. `service_status_lookup` can read a configured file
  projection fixture for deterministic runtime tests; `transport_schedule_lookup`
  can now resolve projection-backed schedule snapshot metadata, route
  clarification, departures, service windows, timetables, and temporary
  suspension summaries; `campus_notice_discover` / `campus_notice_get` read the
  internal notice PG read model and S3-compatible derived canonical bodies. This
  still does not open `campus_services` or `notice` product serving.
- Owns bounded FIFO execution admission with queue full / lane queue full /
  queue timeout / lane queue timeout / draining outcomes, `Retry-After` hints,
  and graceful shutdown drain.
- Repo-local `Phase 1-7` implementation is in place:
  cancellation semantics, per-lane admission, shell-owned observability, local
  compose smoke, Python parity rerun, and runback docs are all landed.
- Repo-local `Phase 8-10` implementation is in place:
  cooperative Python bridge cancel signaling, the structured query runtime
  foundation, and the transport schedule query kernel are landed without
  opening `campus_services` product serving.

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

Current cancellation boundary:

- Go shell stops waiting on the Python bridge when the upstream HTTP client
  disconnects or the shell timeout fires.
- `POST /internal/execution/cancel` accepts `{ "request_id": "..." }` with
  `x-worker-origin-auth` and marks the active Go execution as
  `cancel_requested`.
- Go shell also sends a best-effort cooperative cancel to the Python bridge.
  The bridge marks active request ids as `cancel_requested`; this does not yet
  guarantee provider / prompt executor mid-flight termination.

Current structured query runtime boundary:

- Internal query routes require `x-supervisor-query-auth`.
- `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET` enables internal query auth.
- `SUPERVISOR_STRUCTURED_QUERY_PROJECTION_PATH` points at a dev/test file
  projection bundle for the current foundation slice.
- `SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339` pins trusted runtime time
  for deterministic tests; production should normally omit it.
- `SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS` bounds internal query execution.
- `INTERNAL_NOTICE_READ_MODEL_DATABASE_URL` configures the notice read-model PG
  connection; `CAMPUS_SHARED_POSTGRES_URL` is the fallback.
- `INTERNAL_NOTICE_READ_MODEL_TABLE` defaults to
  `ingestion_projection.internal_notice_read_model`.
- `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_DERIVED_ACCESS_KEY` /
  `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_DERIVED_SECRET_KEY` /
  `OBJECT_STORE_SECRET_KEY`, `OBJECT_STORE_REGION`, and
  `OBJECT_STORE_BUCKET_DERIVED` configure notice canonical body reads from the
  S3-compatible derived bucket.
- The runtime is not browser-facing, not an `app-api` product surface, and does
  not open `campus_services` or `notice` query-serving.
- Python orchestration can consume this seam only when
  `SUPERVISOR_STRUCTURED_QUERY_BASE_URL` and
  `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET` are configured in the
  `supervisor-api` worker container.

Current observability boundary:

- `/metrics` is an internal runtime surface, not part of the `app-api` contract.
- Current shell-owned counters distinguish admission decisions, queue depth,
  queue wait, lifecycle final states, bridge latency, bridge timeout /
  unavailability, cooperative bridge cancel outcomes, structured query
  outcomes, and aggregate request outcomes.
- `SUPERVISOR_API_METRICS_BEARER_TOKEN` can protect `/metrics` when the surface
  is reachable outside a trusted local network; local development leaves it
  empty by default.
- OTel trace export is disabled by default. When enabled,
  `SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT` must be configured; telemetry
  export is fail-open for answer requests and surfaces dropped / last-error
  state in `/readyz` and `/metrics`.
- Execution audit backflow is disabled by default. When enabled, Go shell sends
  only safe runtime event summaries for admission rejection, cancel, bridge
  failure, and timeout to `app-api`; it never includes raw `user_goal`, prompt,
  answer, transcript, auth material, retrieval payload, or provider response.
- `/readyz` reports `execution_audit_runtime`, and `/metrics` reports emitted,
  dropped, failed, queue depth, enabled, and configured counters/gauges.

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
export SUPERVISOR_API_OTEL_ENABLED=false
export SUPERVISOR_API_EXECUTION_AUDIT_ENABLED=false
export SUPERVISOR_API_EXECUTION_AUDIT_URL=http://127.0.0.1:8787/api/internal/execution/audit-events
export SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET=app-api-internal-secret
export SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS=500
export SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY=128
export SUPERVISOR_API_REQUEST_TIMEOUT_MS=45000
export SUPERVISOR_PY_BRIDGE_BASE_URL=http://127.0.0.1:18081
export SUPERVISOR_PY_BRIDGE_SHARED_SECRET=bridge-secret
export SUPERVISOR_PY_BRIDGE_TIMEOUT_MS=35000
export SUPERVISOR_PY_BRIDGE_CANCEL_TIMEOUT_MS=500
export SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET=query-secret
export SUPERVISOR_STRUCTURED_QUERY_BASE_URL=http://127.0.0.1:27010
export SUPERVISOR_STRUCTURED_QUERY_PROJECTION_PATH=
export SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339=
export SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS=1000
export INTERNAL_NOTICE_READ_MODEL_DATABASE_URL=
export INTERNAL_NOTICE_READ_MODEL_TABLE=ingestion_projection.internal_notice_read_model
export OBJECT_STORE_ENDPOINT=
export OBJECT_STORE_DERIVED_ACCESS_KEY=
export OBJECT_STORE_DERIVED_SECRET_KEY=
export OBJECT_STORE_REGION=us-east-1
export OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived
```

Staging lifecycle derives execution audit URL and shared secret from
`GO_SHELL_STAGING_APP_API_BASE_URL` and `APP_API_INTERNAL_SHARED_SECRET` when the
explicit `SUPERVISOR_API_EXECUTION_AUDIT_*` variables are absent. Generic local
compose keeps execution audit disabled unless explicitly enabled.

Local verification:

```bash
pnpm go:static:check
pnpm go:check
```

Docker build:

```bash
docker build -f apps/go-shell/Dockerfile -t campus-go-shell:local .
```

Docker smoke:

```bash
docker run --rm -p 18080:8000 campus-go-shell:local
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

- [go-shell-local-runtime-smoke.md](/home/reptilian/code/campus-agent/docs/runbooks/go-shell-local-runtime-smoke.md)
