---
doc_type: state
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# State: Supervisor API Docker Dev Package Hardening

## Current Status

- status: `backlog`
- current slice: planning created; no implementation started
- owner: unassigned
- active implementation: no

## Current Repo Facts

- `apps/supervisor-api/Dockerfile` exists and builds the Go `supervisor-api` binary.
- `infra/local/docker-compose.supervisor-runtime.yml` defines the local two-container runtime:
  `supervisor-api + supervisor-agent-worker`.
- `infra/local/start-supervisor-runtime.sh` loads repo root `.env` and `apps/app-api/.dev.vars`,
  rewrites local hostnames for Docker, then runs compose.
- `infra/local/smoke-supervisor-runtime.sh` already supports `closed_gate`, `bridge_semantic`,
  `open_structured`, and `readyz_degraded` profiles.
- `docs/runbooks/supervisor-api-local-runtime-smoke.md` documents local Docker-first smoke.
- `docs/runbooks/supervisor-api-staging-operations.md` documents the current WSL scheduled task +
  named tunnel staging host lifecycle.
- `uv run --all-packages python -m scripts.doctor_env supervisor-api --json` currently reports
  `overall_ready=true` on this machine, but many execution-runtime deployment inputs are still
  optional in the doctor surface.

## Captured Gaps

- Doctor gate is too weak for deploy readiness:
  - bridge base URL / secret are optional
  - worker timeout and admission budgets are optional
  - structured runtime dependencies are not conditional on opened capabilities
- README single-container Docker smoke can be misread as full execution smoke.
- Compose lacks healthcheck / restart / logging / resource / security posture.
- Local smoke does not produce a standard evidence artifact bundle.
- Env ownership lacks a supervisor-runtime command-scoped template.
- Staging lifecycle docs are WSL-host specific and should not be reused as generic Linux server
  deployment instructions.
- Package-level acceptance commands are spread across README/runbooks rather than captured as one
  deployment gate.

## Planned Execution Order

1. `Phase 0`: package truth and gap baseline.
2. `Phase 1`: supervisor-api doctor gate hardening.
3. `Phase 2`: compose runtime hardening.
4. `Phase 3`: env inventory and command template.
5. `Phase 4`: local smoke evidence artifact.
6. `Phase 5`: README and runbook command correction.
7. `Phase 6`: server handoff package.
8. `Phase 7`: deployment package acceptance.

## Immediate Next Slice

When this workstream is promoted, start with Phase 0 and Phase 1. Do not start with compose
resource knobs before the readiness gate is corrected, otherwise package smoke may still produce
false-positive deploy readiness.

## Verification Baseline

Use these after planning-only edits:

```bash
pnpm docs:lint
```

Use these after initial implementation:

```bash
uv run --all-packages python -m unittest \
  tests.test_doctor_env \
  tests.test_supervisor_api_local_runtime -q
pnpm shell:lint
pnpm yaml:lint
pnpm docs:lint
```

## Continuity Notes

- Keep this separate from `supervisor-docker-runtime-language-split`.
- Keep product capability gates closed unless another workstream explicitly opens them.
- Treat WSL scheduled task evidence as staging-host evidence only, not general server proof.
