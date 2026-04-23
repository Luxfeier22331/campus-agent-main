# go-shell

`apps/go-shell` is the Go execution shell for the Docker-side supervisor runtime.

Current status:

- Implements the Docker-side HTTP shell for `GET /healthz`, `GET /readyz`,
  `GET /metrics`, and `POST /api/v1/answer`.
- Owns request body limits, JSON parsing, `bearer` / `trusted-worker` caller
  auth, request projection, fail-closed bridge handling, and global execution
  admission.
- Projects the external execution request into private
  `SupervisorRequest -> SupervisorResponse` JSON and calls the Python
  orchestration bridge at `/internal/bridge/*`.
- Aggregates Python worker readiness into shell-owned `/readyz`, while keeping
  Go transport admission as the published `transport_runtime`.
- Exposes shell-owned Prometheus-style runtime counters at `/metrics`.
- Emits answer-path structured logs with `trace_id`, `status_code`, `outcome`,
  and `duration_ms`, without logging raw `user_goal`.
- Repo-local `Phase 1-6` implementation is in place:
  cancellation semantics, shell-owned observability, local compose smoke,
  Python parity rerun, and runback docs are all landed.

Current cancellation boundary:

- Go shell stops waiting on the Python bridge when the upstream HTTP client
  disconnects or the shell timeout fires.
- There is no separate cancel endpoint yet.
- Once Python orchestration work has been dispatched, the current bridge does
  not guarantee mid-flight cooperative cancellation inside the Python worker.

Current observability boundary:

- `/metrics` is an internal runtime surface, not part of the `app-api` contract.
- Current shell-owned counters distinguish transport saturation, bridge timeout,
  bridge unavailability, and aggregate request outcomes.
- OTel collector / sink fan-out is still deferred; this slice only closes the
  shell-owned metrics and structured logging seam.

Requirements:

- Go `1.26.x`
- Docker for container smoke checks

Key env:

```bash
export API_AUTH_MODE=trusted-worker
export API_WORKER_SHARED_SECRET=worker-secret
export SUPERVISOR_PY_BRIDGE_BASE_URL=http://127.0.0.1:18081
export SUPERVISOR_PY_BRIDGE_SHARED_SECRET=bridge-secret
```

Local verification:

```bash
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
