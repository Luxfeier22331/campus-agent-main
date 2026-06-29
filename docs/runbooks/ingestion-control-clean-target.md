---
doc_type: runbook
truth_scope: ops
owner_boundary: apps/ingestion-control
status: active
created: 2026-06-12
updated: 2026-06-12
---

# Ingestion Control Clean-Target Runbook

## Scope

This is the active ingestion/data-plane operational entrypoint after retiring
legacy Python collection CLIs.

Legacy Python collection module commands, on-demand batch wrappers, registry
release CLIs, root ingestion runtime smoke/report scripts, Qdrant backup/GC
CLIs and serving seed CLIs are not active operation surfaces.

## Active Runtime Boundary

- `apps/ingestion-control` owns task admission, idempotency, claim / lease,
  retry, dead-letter, terminal closeout and operator-safe projection snapshots.
- `configs/ingestion/<corpus>/<collection>/task-registry.v1.json` declares task
  topology with `ts_control` or `rust_kernel` executors only.
- `packages/ingestion-kernels-rs` owns deterministic file kernels.
- `apps/ingestion-worker` is a Python adapter island for extraction work that
  genuinely needs Python, currently legacy Office normalization.
- Eval-owned Python verification must not live under `packages/evals`; it is not
  an ingestion fallback or collection operation surface.

## Local Control Plane

```bash
export INGESTION_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
pnpm --filter ingestion-control start
```

Health:

```bash
curl -fsS http://127.0.0.1:8000/readyz
```

## Registry Validation

```bash
pnpm --filter ingestion-contracts test
pnpm --filter ingestion-control test -- task-registry.test.ts
```

The registry contract rejects Python adapter executors. If a task requires
Python extraction, model that as a TS-controlled task that invokes a private
adapter process behind an explicit task handler. Do not add a registry fallback
executor.

## Task Closeout

Task terminal state is recorded through ingestion-control:

- `completed`
- `failed`
- `dead_lettered`

Operator views must consume redacted task projections from ingestion-control.
They must not call object store, Qdrant, registry release logic or Python
adapters directly.

## Historical Instructions

Historical Python worker runbook bodies have left branch tip. They are not
current operating instructions; recover specific old fragments through git
history only when they need to be promoted into current docs.
