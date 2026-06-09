# execution-control

`apps/execution-control` is the Go-owned execution-control runtime for the
Docker-side Temporal execution plane.

Current status:

- Implements the Docker-side HTTP runtime for `GET /healthz`, `GET /readyz`,
  `GET /metrics`, `POST /internal/execution/runs`,
  `GET /internal/execution/runs/:runId`,
  `GET /internal/execution/runs/:runId/events`,
  `GET /internal/execution/runs/:runId/steps`,
  and `POST /internal/execution/runs/:runId/cancel`.
- Owns request body limits, JSON parsing, `bearer` / `trusted-worker` caller
  auth, strict environment parsing, request projection, Temporal command/query/
  cancel, lifecycle registry, explicit cancel, and global / per-lane execution
  admission.
- Infers deterministic effective `requested_capability` and execution lane for
  common navigation, campus-services, notice, and knowledge requests when the
  caller omits an explicit capability.
- Starts Temporal `ChatAnswerWorkflow` and executes the current seven-step RAG
  graph through Go worker roles:
  `planning -> rag.plan -> retrieval.indexed_lookup ->
  retrieval.expand_or_rescue -> evidence.selection -> synthesis ->
  grounding.verify -> finalization.write`.
- Reports Go-owned `/readyz` runtime health for Temporal, run projection store,
  RAG lookup/synthesis, prompt pricing gate, capability gates and worker pollers.
- Exposes Go-owned Prometheus-style runtime counters at `/metrics`.
- Keeps metrics route labels bounded; unknown routes are reported as
  `/__unknown__` instead of raw URL paths.
- Emits answer-path structured logs with `trace_id`, `status_code`, `outcome`,
  and `duration_ms`, without logging raw `user_goal`.
- Emits allowlisted execution audit events to `app-api` internal ingest when
  configured. Execution audit is disabled by default; when explicitly enabled,
  delivery is synchronous and fail-closed, so sink failures stop answer
  completion with a stable diagnostic error.
- Owns Go RAG lookup via Qdrant native adapter and Go provider-backed synthesis;
  provider usage, estimated cost, cancel outcome and timeout outcome are written
  to sanitized step attempt/result projection.
- Retired Python bridge env and bridge breaker env are rejected by config parsing;
  they are not serving compatibility knobs.
- Owns deterministic runtime planning in `internal/structuredplanning`,
  including RAG DTO projection and structured campus-services / notice payload
  projection; `internal/execution` adapts request projection into current
  runtime decisions.
- Retired bridge v6 handoff artifacts may remain for offline/eval compatibility
  tests; they are not an active online serving compatibility path.
- Owns deterministic runtime policy in `internal/runtimepolicy`, including
  product scope gate, high-risk approval / reject gate, context follow-up
  preflight, query-enabled scope admission, and structured tool policy version.
  Runtime policy decisions are projected into run metadata and summarized in
  Go-owned metrics, OTel attributes, and execution audit events without
  including raw user text.
- Owns Temporal workflow command admission and sanitized run projection writes.
  Terminal answer delivery is read from product projection through `app-api`,
  not from a synchronous execution-control answer endpoint.
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
- When `campus_services`, `navigation`, or `notice` is explicitly opened, deterministic
  structured payloads run as typed Temporal activities and write sanitized
  projections. `app-api` remains the browser-facing answer/status/event surface.
- Owns bounded FIFO execution admission with queue full / lane queue full /
  queue timeout / lane queue timeout / draining outcomes, `Retry-After` hints,
  and graceful shutdown drain.
- Repo-local `Phase 1-7` implementation is in place:
  cancellation semantics, per-lane admission, Go-owned observability, local
  compose smoke, Python parity rerun, and runback docs are all landed.
- Repo-local `Phase 8-12` implementation is in place: the structured query runtime
  foundation and transport schedule query kernel are landed without opening
  `campus_services` product serving.
- Python `apps/supervisor-agent-worker` is not part of online answer serving,
  readiness aggregation or worker topology. It is retained only for offline /
  eval / tooling / historical bridge reference.
- Repo-local lifecycle streaming is owned by `app-api` over projection/event
  reads. `execution-control` does not expose the retired lifecycle answer SSE
  endpoint.

Current admission boundary:

- Temporal task queues own durable workflow/activity scheduling. The legacy
  in-process answer queue no longer participates in online serving.
- `EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS` and lane budget env remain
  admission/policy knobs for request validation and future activity budgeting,
  not the canonical execution queue.
- Lane budgets are configured with
  `EXECUTION_CONTROL_LANE_<LANE>_MAX_CONCURRENT`,
  `EXECUTION_CONTROL_LANE_<LANE>_QUEUE_CAPACITY`, and
  `EXECUTION_CONTROL_LANE_<LANE>_QUEUE_TIMEOUT_MS`.
- Current lanes are `rag`, `navigation`, `campus_services`, `notice`, and
  `default`; unset lane budgets inherit the global budget.
- `active_answers == max_concurrent_answers` does not by itself make `/readyz`
  degraded if the queue can still accept short bursts.
- Retired `EXECUTION_CONTROL_BRIDGE_*` and `SUPERVISOR_AGENT_WORKER_*` settings
  fail closed in online execution-control config. Do not use them as local or
  staging runtime inputs.
- `EXECUTION_CONTROL_QUERY_SERVING_SCOPES_PATH` points at the Go-owned
  query-serving scope allowlist. When unset, local repo runs discover
  `configs/runtime/query-serving-scopes.v1.json` from the repo root; if no
  policy file is found, knowledge scoped requests fail closed. The Docker image
  sets this env var to `/etc/campus-agent/query-serving-scopes.v1.json`.
- `EXECUTION_CONTROL_INTENT_POLICY_PATH` points at the Go-owned intent policy
  artifact. The server loads this artifact once at startup and uses that runtime
  snapshot for request routing; Docker sets it to
  `/etc/campus-agent/intent-policy.v1.json`.
- `EXECUTION_CONTROL_PROVIDER_PRICING_PATH` points at the Go-owned online provider
  pricing catalog. `/readyz` fails closed when an admitted online model lacks
  pricing metadata; Docker sets it to
  `/etc/campus-agent/provider-pricing.v1.json`.

Current cancellation boundary:

- `POST /internal/execution/runs/:runId/cancel` is the active internal cancel
  command. execution-control cancels the Temporal workflow first, then writes
  sanitized cancel projection.
- Activity cancel/timeout is projected through step attempts. Go lookup/provider
  adapters must use cancellable context and record whether downstream work was
  aborted, timed out, completed before cancel, or remained `abort_unproven`.
- Old request-id cancel route and Python cooperative bridge cancel are retired
  from online serving.

Current structured query runtime boundary:

- Internal query routes require `x-supervisor-query-auth`.
- Structured product serving gates for `campus_services` and `notice` are
  closed by default. `EXECUTION_CONTROL_OPEN_CAPABILITIES` is the Go-owned
  allowlist for opening those capabilities after eval / product admission
  evidence exists. It accepts `campus_services`, `navigation`, `notice`, or
  comma-separated combinations of these values; wildcard values such as `*` or
  `all` are rejected.
- `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET` enables internal query auth
  and is injected by the execution runtime harness.
- `CAMPUS_SHARED_POSTGRES_URL` is the single PostgreSQL connection used by
  `service_status_lookup`, `transport_schedule_lookup`, `service_guide_lookup`,
  `contact_directory_lookup`, and `academic_calendar_lookup` for the release
  catalog, current pointer, and typed read models.
- Structured projection schema and read-model table names are fixed by the
  `ingestion_projection` contract, not runtime env.
- `EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339` pins trusted runtime
  time for deterministic tests; production should normally omit it.
- `EXECUTION_CONTROL_STRUCTURED_QUERY_TIMEOUT_MS` bounds internal query execution.
- `EXECUTION_CONTROL_NOTICE_BODY_LIMIT_BYTES` bounds canonical notice body reads
  from object storage.
- `INTERNAL_NOTICE_READ_MODEL_DATABASE_URL` configures the notice read-model PG
  connection; if unset, the runtime uses `CAMPUS_SHARED_POSTGRES_URL` as the
  shared database connection.
- `INTERNAL_NOTICE_READ_MODEL_TABLE` defaults to
  `ingestion_projection.internal_notice_read_model`.
- `EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT`,
  `EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY`,
  `EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY`,
  `EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION`, and
  `EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET` configure notice canonical
  body reads from the S3-compatible notice body bucket. The bucket may
  physically be the ingestion derived bucket, but the Go runtime does not read generic
  ingestion `OBJECT_STORE_*` variables.
- The runtime is not browser-facing and not an `app-api` product surface. It
  does not open `place_lookup`; navigation / map-backed place lookup remains
  deferred until the map product rollout.
- Typed Temporal activities use the same projection-backed query runtime after
  the structured capability opening gate admits the request.
- `/readyz` reports `capability_gates` so operators can see whether
  `campus_services` / `notice` are still closed, and `/metrics` reports
  capability gate open / closed decisions.
- `/readyz` degrades if `campus_services` or `notice` is opened before its
  required structured runtime dependencies are configured, and if any opened
  capability is missing its required Temporal activity task queue poller.

Current observability boundary:

- `/metrics` is an internal runtime surface, not part of the `app-api` contract.
- Current Go-owned counters distinguish admission decisions, queue depth,
  queue wait, lifecycle final states, Temporal command/query/cancel, task queue
  readiness, RAG lookup/synthesis outcomes, structured query outcomes,
  structured capability gate decisions, bounded runtime policy decision
  summaries and aggregate request outcomes.
- `EXECUTION_CONTROL_METRICS_BEARER_TOKEN` can protect `/metrics` when the surface
  is reachable outside a trusted local network; local development leaves it
  empty by default.
- OTel trace export is disabled by default. When enabled,
  `EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_ENDPOINT` must be configured. Configured
  answer paths fail closed with `telemetry_delivery_failed` when telemetry
  delivery fails; `/readyz` and `/metrics` expose exported / sampled-dropped /
  failed / sample-ratio / last-error state for diagnosis.
- `apps/execution-control` is the online trace owner. It extracts inbound
  `traceparent` / `baggage`, accepts current `app-api` `sentry-trace` as an
  ingress compatibility source, and propagates sanitized trace/run/step context
  into Temporal activity projection.
- Execution audit backflow is disabled by default. When enabled, Go
  `apps/execution-control` sends only safe runtime event summaries for admission
  rejection, cancel, bridge failure, and timeout to `app-api`; it never includes
  raw `user_goal`, prompt, answer, transcript, auth material, retrieval payload,
  or provider response. The runtime decision summary is limited to low-cardinality
  labels such as scope gate, policy gate, context preflight, routing next action,
  planning outcome, selected capability/tool, terminal outcome, and fail-close
  reason.
- `/readyz` reports `execution_audit_runtime`, and `/metrics` reports enabled,
  configured, emitted, and failed counters/gauges. `/readyz` degrades when
  execution audit is enabled but missing its ingest URL or shared secret.

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
export EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS=8
export EXECUTION_CONTROL_QUEUE_CAPACITY=24
export EXECUTION_CONTROL_QUEUE_TIMEOUT_MS=3000
export EXECUTION_CONTROL_LANE_RAG_MAX_CONCURRENT=6
export EXECUTION_CONTROL_LANE_RAG_QUEUE_CAPACITY=12
export EXECUTION_CONTROL_LANE_RAG_QUEUE_TIMEOUT_MS=3000
export EXECUTION_CONTROL_LANE_NAVIGATION_MAX_CONCURRENT=2
export EXECUTION_CONTROL_LANE_NAVIGATION_QUEUE_CAPACITY=4
export EXECUTION_CONTROL_LANE_NAVIGATION_QUEUE_TIMEOUT_MS=1500
export EXECUTION_CONTROL_OPEN_CAPABILITIES=
export EXECUTION_CONTROL_OTEL_ENABLED=false
export EXECUTION_CONTROL_OTEL_SAMPLE_RATIO=1
export EXECUTION_CONTROL_OTEL_ALLOWED_ATTRIBUTES_VERSION=execution-control-otel-attrs-v1
export EXECUTION_CONTROL_EXECUTION_AUDIT_ENABLED=false
export EXECUTION_CONTROL_EXECUTION_AUDIT_URL=http://127.0.0.1:27031/api/internal/execution/audit-events
export EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET=app-api-internal-secret
export EXECUTION_CONTROL_EXECUTION_AUDIT_TIMEOUT_MS=500
export EXECUTION_CONTROL_REQUEST_TIMEOUT_MS=45000
export EXECUTION_CONTROL_INTENT_POLICY_PATH=
export EXECUTION_CONTROL_QUERY_SERVING_SCOPES_PATH=
export EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
export EXECUTION_CONTROL_TEMPORAL_ADDRESS=127.0.0.1:7233
export EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-local
export EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY=local:workflow-worker:001
export EXECUTION_CONTROL_TEMPORAL_RAG_WORKER_IDENTITY=local:activity-rag:001
export EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY=local:activity-finalization:001
export QDRANT_URL=https://127.0.0.1:6333
export QDRANT_QUERY_API_KEY=qdrant-local-readonly-secret
export QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem
export EMBEDDING_BASE_URL=https://api.openai.com/v1
export EMBEDDING_API_KEY=
export EMBEDDING_MODEL=text-embedding-3-small
export PROMPT_RUNTIME_PROVIDER=openai
export PROMPT_RUNTIME_TRANSPORT=responses
export PROMPT_RUNTIME_BASE_URL=https://api.openai.com/v1
export PROMPT_RUNTIME_API_KEY=
export AGENT_PROMPT_MODEL=gpt-5-mini
export PROMPT_STRICT_STRUCTURED_OUTPUTS=true
export EXECUTION_CONTROL_PROVIDER_PRICING_PATH=configs/runtime/provider-pricing.v1.json
export CAMPUS_SHARED_POSTGRES_URL=
export EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339=
export EXECUTION_CONTROL_STRUCTURED_QUERY_TIMEOUT_MS=1000
export INTERNAL_NOTICE_READ_MODEL_DATABASE_URL=
export INTERNAL_NOTICE_READ_MODEL_TABLE=ingestion_projection.internal_notice_read_model
export EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT=
export EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY=
export EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY=
export EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION=us-east-1
export EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET=
export EXECUTION_CONTROL_NOTICE_BODY_LIMIT_BYTES=1048576
```

Staging lifecycle derives execution audit URL and shared secret from
`EXECUTION_CONTROL_STAGING_APP_API_BASE_URL` and `APP_API_INTERNAL_SHARED_SECRET`
when the explicit `EXECUTION_CONTROL_EXECUTION_AUDIT_*` variables are absent.
Generic local compose keeps execution audit disabled unless explicitly enabled.

Local verification:

```bash
pnpm go:static:check
pnpm go:check
```

Docker build:

```bash
docker build \
  -f apps/execution-control/Dockerfile \
  -t campus-execution-control:local .
```

Worker autoscaler dry-run proof:

```bash
go run ./cmd/worker-autoscaler \
  --input-path /path/to/autoscaler-input.json \
  --evidence-path /path/to/worker-autoscaler-evidence.json
```

This command belongs to the Execution Operations Plane. It reads task queue /
budget observations and writes desired-replica evidence only; it does not write
Temporal workflow state, run projection, step projection, event projection, or
terminal state.

Local runtime smoke:

```bash
infra/local/start-execution-control-runtime.sh
infra/local/smoke-execution-control-runtime.sh closed_gate
```

This starts the Docker compose execution runtime and verifies execution-control,
Temporal, workflow worker, RAG activity worker, finalization activity worker,
run projection store and RAG runtime readiness.

Docker smoke:

```bash
docker run --rm -p 27051:8000 campus-execution-control:local
```

`docker run` 单容器只验证 `execution-control` 自身监听和 `/healthz` 路径；它不会覆盖
Temporal pollers、RAG runtime、`/readyz` runtime aggregation 或 answer execution。

Local two-container smoke:

```bash
infra/local/smoke-execution-control-runtime.sh closed_gate
```

Smoke artifacts default to:

```bash
.tmp/execution-control-local-smoke/<timestamp>-<profile>/
```

Expected behavior:

```bash
curl http://127.0.0.1:27051/healthz
curl -i http://127.0.0.1:27051/readyz
curl http://127.0.0.1:27051/metrics
curl -i -H 'content-type: application/json' \
  -H 'x-worker-origin-auth: worker-secret' \
  -d @<(cat <<'JSON'
{
  "run_id": "req-local-smoke-001",
  "conversation_id": "conv-local-smoke-001",
  "turn_id": "turn-local-smoke-001",
  "request_id": "req-local-smoke-001",
  "trace_id": "trace-local-smoke-001",
  "owner_user_id": "student-001",
  "surface": "local-smoke",
  "requested_capability": "knowledge",
  "selected_capability": "knowledge",
  "lane": "rag",
  "runtime_versions": {
    "contract": "temporal-execution-control-v1"
  },
  "user_goal": "hello",
  "metadata": {
    "execution_payload": {
      "user_goal": "hello",
      "request_id": "req-local-smoke-001",
      "conversation_id": "conv-local-smoke-001",
      "trace": {
        "trace_id": "trace-local-smoke-001"
      },
      "runtime_decisions": {
        "runtime_decision_summary": {}
      }
    },
    "handoff": {
      "target": "rag-tool",
      "payload_kind": "rag_request",
      "allowed_tools": ["retrieval.query"],
      "payload": {
        "query_text": "hello"
      }
    }
  },
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
  http://127.0.0.1:27051/internal/execution/runs
```

Detailed local smoke / cutover / runback steps:

- [execution-control-local-runtime-smoke.md](../../docs/runbooks/execution-control-local-runtime-smoke.md)
