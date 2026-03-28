# Protected Panel Runtime API Inventory

## Status

Current execution-truth inventory for the first protected panel rollout.

This inventory only records panel-facing runtime seams and current ownership assumptions. It does not authorize direct package, database, object-store, or index access.

## Inventory Rules

- The panel may call runtime APIs only.
- Browser traffic must terminate on panel-local `/api/*`.
- The Worker-local BFF may aggregate runtime responses, but it must not bypass runtime ownership.
- If a safe runtime API does not exist yet, the panel capability remains blocked.

## Domain Inventory

### Overview

Panel-facing routes:

- `GET /api/overview`

Runtime owner:

- `apps/protected-panel-web` Worker-local BFF
- may consume `GET /healthz` and `GET /readyz` from declared runtime boundaries such as `apps/supervisor-api`

Current state:

- partially implementable now
- panel shell can expose local shell/runtime summary immediately
- upstream runtime health/readiness summary can be added only through declared runtime URLs

Allowed data sources:

- panel shell env and runtime metadata
- runtime-owned health/readiness endpoints

Forbidden shortcuts:

- direct package import
- direct registry/database/object-store reads

### Requests

Panel-facing routes:

- `GET /api/operator/requests`
- `GET /api/operator/requests/:id`

Expected runtime owner:

- `apps/app-api` as the shared product backend boundary

Current state:

- blocked
- the repo has accepted `app-api` ownership in docs, but the actual `apps/app-api` runtime is not landed yet
- `apps/supervisor-api` still only exposes `/api/v1/answer` plus minimal audit writing
- `apps/app-api` still does not expose `GET /api/operator/requests` or `GET /api/operator/requests/:id`
- the current audit sink is not a request projection store
- no safe request-projection runtime API exists yet

Blocked reason:

- no queryable request projection store exists
- no current list/detail request projection surface exists
- panel must not fall back to consumer chat tables, raw audit logs, or telemetry sinks

### Jobs

Panel-facing routes:

- `GET /api/jobs`
- `GET /api/jobs/:id`

Expected runtime owner:

- future job projection runtime owned by an explicit app/runtime boundary
- likely backed by ingestion/eval/smoke runtime shells, not direct worker CLI or storage access

Current state:

- delayed pending re-discussion
- `apps/ingestion-worker` exposes command shells, not an HTTP job projection API
- current implementation must not assume `Jobs` belongs in the first panel rollout

Blocked reason:

- no current job list/detail runtime API exists
- product scope is being re-discussed before any job projection work resumes

### Operations

Panel-facing routes:

- `POST /api/operations/*`

Expected runtime owner:

- explicit runtime-owned operator action endpoints

Current state:

- delayed pending re-discussion
- should not start until product scope and action safety are explicitly re-approved

### Audit

Panel-facing routes:

- `GET /api/audit`
- `GET /api/audit/:id`

Expected runtime owner:

- future runtime-facing audit projection surface owned by an explicit app boundary

Current state:

- blocked
- no safe app-facing audit projection API exists yet

Blocked reason:

- no runtime-facing audit query surface exists

## First Implementation Cut

The first implementation cut is allowed to land only:

- `GET /healthz`
- `GET /readyz`
- `GET /`
- `GET /api/overview`

The first implementation cut must not pretend the following are ready when no runtime owner exists yet:

- `GET /api/operator/requests`
- `GET /api/operator/requests/:id`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/audit`
- `GET /api/audit/:id`
- `POST /api/operations/*`

Current execution note:

- `Jobs` and `Operations` are delayed pending re-discussion and must not be implemented by default in the current rollout

## Forbidden Direct Access List

- `packages/contracts`
- `packages/supervisor-core`
- `packages/rag-specialist`
- `packages/retrieval-core`
- internal document registries
- object storage buckets
- vector indexes
- ingestion worker local state
- audit log files as a direct browser or BFF data source

## Next Unlock Conditions

`Requests` unlocks when:

- a safe request list/detail runtime API exists
- the runtime owner is `apps/app-api`, not a panel-local bypass or `apps/supervisor-api` fallback

`Jobs` unlocks when:

- a safe job list/detail runtime API exists
- product scope explicitly reconfirms that `Jobs` belongs in the rollout

`Operations` unlocks when:

- at least one controlled operator action has an explicit runtime endpoint and audit path
- product scope explicitly reconfirms that `Operations` belongs in the rollout

`Audit` unlocks when:

- a safe audit projection runtime API exists
