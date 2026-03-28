# Protected Panel Runtime API Inventory

## Status

Current execution-truth inventory for the next protected panel expansion after `Overview` and `Requests` landed on top of shared `apps/app-api`.

This inventory only records panel-facing runtime seams and current ownership assumptions. It does not authorize direct package, database, object-store, queue, or index access.

## Inventory Rules

- The panel may call runtime APIs only.
- Browser traffic must terminate on panel-local `/api/*`.
- The Worker-local BFF may aggregate runtime responses, but it must not bypass runtime ownership.
- If a safe runtime API does not exist yet, the panel capability remains blocked.
- Focused `Official Web` operator views are preferred over generic infrastructure consoles.

## Domain Inventory

### Overview

Panel-facing routes:

- `GET /api/overview`

Runtime owner:

- `apps/protected-panel-web` Worker-local BFF
- may consume declared health/readiness endpoints from owned runtime boundaries

Current state:

- landed baseline
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

Runtime owner:

- `apps/app-api` as the shared application/control-plane backend

Current state:

- landed baseline
- canonical runtime-owned request projection APIs already exist on `apps/app-api`
- panel must continue to consume those APIs rather than any fallback data source

Allowed data sources:

- `apps/app-api` operator request projection APIs only

Forbidden shortcuts:

- consumer chat tables
- raw audit logs
- telemetry sinks
- `apps/supervisor-api` fallback query routes

### Official Web

Panel-facing routes:

- `GET /api/official-web/sites`
- `GET /api/official-web/sites/:siteId`
- `GET /api/official-web/runs`
- `GET /api/official-web/runs/:runId`

Expected runtime owner:

- `apps/app-api` official_web control-plane APIs

Current state:

- accepted direction, not yet implemented
- the repo has accepted `app-api` ownership for collector admission, crawl-run ledger, artifact refs, and operator site/run/detail queries
- no current safe `official_web` site/run/detail API exists yet

Blocked reason:

- `official_web` control-plane schema and endpoints are not landed yet
- panel must not synthesize these views from object storage listings, queue state, ingestion-worker internals, or Qdrant

### Jobs

Panel-facing routes:

- `GET /api/jobs`
- `GET /api/jobs/:id`

Expected runtime owner:

- future job projection runtime owned by an explicit app/runtime boundary
- likely backed by ingestion/eval/smoke runtime shells, not direct worker CLI or storage access

Current state:

- delayed pending re-discussion
- current implementation must not assume `Jobs` belongs in the first panel rollout

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

- delayed pending re-discussion
- no generic audit console should be inferred from `Official Web` work

## Next Implementation Cut

The next implementation cut is allowed to expand with:

- `GET /api/overview`
- existing `GET /api/operator/requests`
- existing `GET /api/operator/requests/:id`
- `GET /api/official-web/sites`
- `GET /api/official-web/sites/:siteId`
- `GET /api/official-web/runs`
- `GET /api/official-web/runs/:runId`

The next implementation cut must not pretend the following are ready by default:

- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/audit`
- `GET /api/audit/:id`
- `POST /api/operations/*`

## Forbidden Direct Access List

- `packages/contracts`
- `packages/supervisor-core`
- `packages/rag-specialist`
- `packages/retrieval-core`
- internal document registries
- object storage buckets
- queue backlogs
- vector indexes
- ingestion worker local state
- audit log files as a direct browser or BFF data source

## Next Unlock Conditions

`Official Web` unlocks when:

- a safe site/run/detail runtime API exists
- the runtime owner is `apps/app-api`, not a panel-local bypass
- crawl status and ingestion dispatch status are both queryable without reading infrastructure directly

`Jobs` unlocks when:

- a safe job list/detail runtime API exists
- product scope explicitly reconfirms that `Jobs` belongs in the rollout

`Operations` unlocks when:

- at least one controlled operator action has an explicit runtime endpoint and audit path
- product scope explicitly reconfirms that `Operations` belongs in the rollout

`Audit` unlocks when:

- a safe audit projection runtime API exists
