---
doc_type: state
status: active
created: 2026-04-27
updated: 2026-04-27
---

# State: Supervisor API Server Live Acceptance

## Current Status

- status: `active`
- current phase: `Phase 0`
- owner: unassigned
- active implementation: no
- target host: `ubuntu-43`
- target host access: Windows-side SSH alias

## Current Scope

This workstream only validates service-side runtime acceptance on a non-WSL Linux host.

It does not validate:

- long-running production operation
- server-side image build
- production ingress
- capacity / stress / soak behavior
- `app-api` upstream integration

## Known Host Facts

Observed on 2026-04-27 via Windows SSH alias `ubuntu-43`:

- OS: `Ubuntu 24.04.4 LTS`
- hostname: `VM-0-2-ubuntu`
- user: `ubuntu`
- Docker: `29.3.0`
- Docker Compose: `v5.1.0`
- CPU: `2`
- memory: `1.9Gi` total, approximately `930Mi` available at observation time
- swap: `1.9Gi` total
- disk: `/` has `38G` available
- existing Docker containers: none running at observation time
- existing listeners:
  - `*:80`
  - `*:443`
  - `0.0.0.0:22`
  - loopback service ports
- candidate acceptance ports:
  - `18080`: no listener observed
  - `38080`: no listener observed

## Planned Runtime Parameters

- remote directory: `~/campus-agent-supervisor-acceptance`
- compose project: `campus-supervisor-live-acceptance`
- host bind: `127.0.0.1:38080`
- profile: `closed_gate`
- image mode: no server-side build
- capability gates: closed

## Immediate Next Slice

Start `Phase 0` by refreshing host facts and writing the exact command/output summary into this
state file. Do not transfer deployment material until the refreshed facts still match the planned
runtime parameters.

## Planned Verification Evidence

Expected final artifact set:

- remote artifact directory under `~/campus-agent-supervisor-acceptance/artifacts/`
- `summary.json`
- `healthz.json`
- `readyz.json`
- `metrics.txt`
- `answer.json`
- `compose-ps.txt`
- `container-health.json` or equivalent inspect output
- cleanup verification output

## Continuity Notes

- This workstream closes the live-only gap left by
  `supervisor-api-docker-dev-package-hardening`.
- It must not introduce new deployment topology truth.
- It must not change existing `80/443` business ingress.
- It must not use `docker build` or `compose up --build` on `ubuntu-43`.
