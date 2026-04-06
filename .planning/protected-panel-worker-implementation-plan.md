# Protected Panel Worker Implementation Plan

## Status

Current execution-truth plan for expanding `apps/protected-panel-web` beyond the landed `Overview` + `Requests` baseline.

It does not reopen:

- `Cloudflare Workers` as the panel runtime
- `react-admin` as the preferred UI shell direction
- `Hono` as the preferred Worker-local BFF direction
- `runtime APIs only` as the allowed integration seam
- shared `app-api` ownership of request projection read models
- `official_web` control-plane ownership on `apps/app-api`

## Purpose

Expand the protected operator control plane under the canonical `apps/protected-panel-web` boundary so that it:

- remains a standalone `apps/*` runtime boundary
- stays fail-closed behind upstream protected access and origin assertion validation
- uses `react-admin` as the panel shell
- uses a Worker-local `Hono` BFF for panel-facing `/api/*`
- keeps `Requests` stable while adding a focused `Official Web` domain
- avoids generic infrastructure-console sprawl

## Frozen Constraints

- The panel must not become `apps/supervisor-api` hidden admin mode.
- The panel must not import `packages/*` directly.
- Browser code must not call internal runtime surfaces directly.
- The Worker origin must validate `Cf-Access-Jwt-Assertion` or an equivalent signed access assertion.
- The panel is not a full user system, CMS, database console, object storage console, queue console, or arbitrary shell.
- The panel must remain an operator control plane, not a generic internal-tools platform.
- `Requests` must not read from consumer chat tables, raw audit logs, or telemetry sinks as a fallback data source.
- `Requests` must be served by shared `apps/app-api`, not by `apps/supervisor-api`.
- `Official Web` must be served by shared `apps/app-api`, not by object-storage browsing, ingestion-worker introspection, or ad hoc status synthesis.

## Product Outcome Definition

The next protected-panel expansion counts as landed only when all of the following are true:

- a protected hostname is fronted by Cloudflare Access
- the Worker origin validates upstream access assertions and fails closed
- the panel UI runs through `react-admin`
- browser traffic stays on panel-local `/api/*`
- the Worker-local BFF talks to runtime APIs only
- `Overview` remains stable for operator use
- `Requests` remains stable on shared `apps/app-api`
- `Official Web / Sites`, `Official Web / Crawl Runs`, and `Run Detail` are usable through shared `apps/app-api`
- `Jobs`, `Operations`, and generic `Audit` remain explicitly delayed unless scope is reopened
- staging/prod deployment and rollback seams are explicit
- automated auth rejection and operator-path smoke coverage exist

## Delivery Shape

Target runtime shape:

`authorized operator -> protected hostname -> Cloudflare Access -> Worker shell -> Hono BFF -> shared app-api runtime APIs`

Target frontend shape:

`react-admin <Admin> shell -> authProvider -> dataProvider -> CustomRoutes/resources -> Worker-local /api/*`

## Non-Goals

This plan does not deliver:

- a self-serve end-user account system
- a database console
- an object-storage, queue, or index console
- a generic low-code internal-tools builder
- arbitrary shell / SQL / internal API proxy access
- reopening Phase 5 governance decisions through the panel shell

## Execution Roadmap

### Phase 0. Freeze Next Domain Inventory

Goal:

- freeze the next panel expansion around focused `Official Web` operator pages instead of generic ops domains

Deliverables:

- updated runtime API inventory
- explicit runtime owner for each `Official Web` capability
- explicit forbidden direct-access list

Exit criteria:

- each planned `Official Web` page has a declared runtime API dependency
- no page relies on direct object-store, queue, or package access
- missing `official_web` runtime APIs are treated as blockers, not excuses to bypass the boundary

### Phase 1. App API Official Web Query Surface

Goal:

- land the runtime-owned `official_web` site/run/detail APIs on shared `apps/app-api`

Deliverables:

- site list/detail endpoints
- crawl-run list/detail endpoints
- stable response shapes for status, artifacts, failures, and ingestion dispatch
- Worker app entry and static asset delivery setup
- Worker Custom Domain deploy config for protected hostname plus panel-specific runtime API base URL env contract
- fail-closed default handling for unknown or unadmitted routes
- explicit separation from `apps/supervisor-api`
- health/readiness endpoints that survive the Worker deployment model

Reference direction:

- borrow the technical organization pattern from `cloudflare/templates/vite-react-template`
- do not copy the template wholesale as the business boundary

Exit criteria:

- panel never needs to infer `official_web` state from infrastructure data
- `apps/supervisor-api` remains uninvolved

### Phase 2. Worker-Local BFF Adapters

Goal:

- extend the panel BFF with explicit `Official Web` adapters

Deliverables:

- `/api/official-web/sites`
- `/api/official-web/sites/:siteId`
- `/api/official-web/runs`
- `/api/official-web/runs/:runId`
- normalized upstream error handling

Exit criteria:

- browser traffic only calls Worker-local `/api/*`
- BFF handlers never import `packages/*`
- upstream runtime failures are normalized into panel-safe responses

### Phase 3. Official Web UI Domain

Goal:

- add the first focused operator domain beyond `Requests`

Deliverables:

- `Official Web / Sites`
- `Official Web / Crawl Runs`
- `Run Detail`
- `Failures` / `Artifacts` summary sections

Hard rules:

- do not add a raw object-storage browser
- do not expose queue backlogs or Qdrant control surfaces
- do not reframe this as a generic jobs console

### Phase 4. Smoke, Auth Rejection, And Operator Workflow Verification

Goal:

- verify the full protected path and the new `Official Web` read-only workflows

Deliverables:

- auth rejection coverage
- BFF contract smoke coverage
- operator-path smoke for sites/runs/detail
- protected hostname and Custom Domain wiring
- Cloudflare Access policy for the small operator group
- Worker env and secret configuration
- staging and production separation
- explicit rollback procedure

Observability deliverables:

- request-id and trace propagation through the Worker shell and BFF
- Worker error capture and logs
- panel-specific API metrics
- admission-failure metrics
- controlled-operation success/failure metrics

Verification deliverables:

- Worker-level tests for assertion validation and fail-closed behavior
- BFF tests for operator context handling and runtime API aggregation rules
- frontend tests for protected route rendering and provider integration
- smoke tests for admitted and rejected operator access paths
- smoke tests for read-only pages
- smoke tests for at least one controlled operation

Exit criteria:

- invalid assertions are rejected at the Worker boundary
- `Official Web` pages work without direct infrastructure access
- runtime/API failures surface clearly to operators
