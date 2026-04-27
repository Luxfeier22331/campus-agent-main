---
doc_type: state
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# State: Supervisor API Server Live Acceptance

## Current Status

- status: `completed`
- completed phase: `Phase 0-5`
- owner: unassigned
- active implementation: no
- target host: `ubuntu-43`
- target host hostname: `VM-0-2-ubuntu`

## Completed Outcomes

- Host baseline confirmed on non-WSL Linux server:
  - OS: `Ubuntu 24.04.4 LTS`
  - Docker: `29.3.0`
  - Docker Compose: `v5.1.0`
  - resources at run time: `2 vCPU`, `1.9GiB RAM`, `1.9GiB swap`, `38G` free disk
  - existing listeners included `*:80` and `*:443`
- No-build deployment path executed:
  - local prebuilt images exported to tar (`206M`)
  - copied to `ubuntu-43`
  - loaded with `docker load`
  - no `docker build` and no `compose up --build` executed on host
- Isolated runtime acceptance executed:
  - remote directory: `~/campus-agent-supervisor-acceptance`
  - compose project: `campus-supervisor-live-acceptance`
  - bind address: `127.0.0.1:38080`
  - capability gates kept closed
- Closed-gate service checks passed:
  - `/healthz` returned `200`
  - `/readyz` returned `200`
  - `/metrics` returned `200`
  - `/api/v1/answer` returned `503`
  - answer body contained `structured_runtime_closed`
- Cleanup and non-interference passed:
  - acceptance containers removed
  - acceptance network removed
  - `38080` released after teardown
  - existing `*:80` and `*:443` listeners still present

## Verification Evidence

- remote artifact root:
  - `/home/ubuntu/campus-agent-supervisor-acceptance/bundle/artifacts/20260427T155723Z-closed_gate`
- remote artifact files:
  - `summary.json`
  - `healthz.json`
  - `readyz.json`
  - `metrics.txt`
  - `answer.json`
  - `compose-ps.txt`
  - `container-health.json`
- key summary fields from remote `summary.json`:
  - `result=passed`
  - `healthz_status_code=200`
  - `readyz_status_code=200`
  - `metrics_status_code=200`
  - `answer_status_code=503`
  - `compose_project=campus-supervisor-live-acceptance`
  - `base_url=http://127.0.0.1:38080`

## Scope Guardrail Confirmation

Validated as out of scope in this workstream:

- long-running production operation
- server-side image build
- production ingress/reverse proxy changes
- capacity/stress/soak testing
- `app-api` upstream integration

## Continuity Notes

- This workstream closes the non-WSL live-only evidence gap for
  `supervisor-api-docker-dev-package-hardening`.
- Reopen only when:
  - new server-live acceptance profile is needed (for example `open_structured`),
  - runtime contract changes invalidate this evidence set, or
  - deployment guardrails/acceptance criteria are updated.
