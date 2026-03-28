# Protected Panel Worker Implementation Plan

## Status

Planning only. This file is the current execution-truth plan for taking `apps/protected-panel-web` from a baseline Worker shell to a real, deployable operator control plane.

It does not reopen:

- `Cloudflare Workers` as the panel runtime
- `react-admin` as the preferred UI shell direction
- `Hono` as the preferred Worker-local BFF direction
- `runtime APIs only` as the allowed integration seam
- shared `app-api` ownership of request projection read models

## Purpose

Implement a protected operator control plane under the canonical `apps/protected-panel-web` boundary so that it:

- remains a standalone `apps/*` runtime boundary
- stays fail-closed behind upstream protected access and origin assertion validation
- uses `react-admin` as the panel shell
- uses a Worker-local `Hono` BFF for panel-facing `/api/*`
- exposes only the operator domains already frozen in long-term docs
- can be deployed as a real protected hostname for a small internal operator group

## Frozen Constraints

- The panel must not become `apps/supervisor-api` hidden admin mode.
- The panel must not import `packages/*` directly.
- Browser code must not call internal runtime surfaces directly.
- The Worker origin must validate `Cf-Access-Jwt-Assertion` or an equivalent signed access assertion.
- The panel is not a full user system, CMS, database console, object storage console, or arbitrary shell.
- The panel must remain an operator control plane, not a generic internal-tools platform.
- `Requests` must not read from consumer chat tables, raw audit logs, or telemetry sinks as a fallback data source.
- `Requests` must be served by shared `apps/app-api`, not by `apps/supervisor-api`.

## Product Outcome Definition

The protected panel counts as landed only when all of the following are true:

- a protected hostname is fronted by Cloudflare Access
- the Worker origin validates upstream access assertions and fails closed
- the panel UI runs through `react-admin`
- browser traffic stays on panel-local `/api/*`
- the Worker-local BFF talks to runtime APIs only
- `Overview` is stable for operator use
- `Requests` is either stable or explicitly held pending runtime API work
- `Jobs` and `Operations` are explicitly delayed pending re-discussion
- at least one usable `Audit` projection is live
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
- an object-storage or index console
- a generic low-code internal-tools builder
- arbitrary shell / SQL / internal API proxy access
- reopening Phase 5 governance decisions through the panel shell

## Execution Roadmap

### Phase 0. Delivery Boundary And Runtime API Inventory

Goal:

- freeze what the panel is allowed to read and trigger before implementation expands

Deliverables:

- first-pass page/domain inventory for `Overview`, `Requests`, `Jobs`, `Operations`, and `Audit`
- explicit runtime owner for each capability
- first-pass panel-facing route inventory
- explicit forbidden direct-access list

Minimum route inventory to freeze first:

- `GET /api/overview`
- `GET /api/operator/requests`
- `GET /api/operator/requests/:id`
- `GET /api/jobs`
- `GET /api/jobs/:id`

Deferred until read paths are stable:

- `POST /api/operations/*`
- `GET /api/audit`
- `GET /api/audit/:id`

Exit criteria:

- each panel page has a declared runtime API dependency
- no page relies on direct database, object-store, or package access
- missing safe runtime APIs are treated as blockers, not excuses to bypass the boundary
- missing request projection APIs are not a reason to build a second request backend inside the panel
- missing `app-api` request APIs are not a reason to route panel reads back into `apps/supervisor-api`

### Phase 1. Worker Shell Baseline

Goal:

- turn the baseline Worker shell into the real Worker-hosted shell for `apps/protected-panel-web`

Deliverables:

- Worker app entry and static asset delivery setup
- panel-specific env contract for protected hostname and runtime API base URL
- fail-closed default handling for unknown or unadmitted routes
- explicit separation from `apps/supervisor-api`
- health/readiness endpoints that survive the Worker deployment model

Reference direction:

- borrow the technical organization pattern from `cloudflare/templates/vite-react-template`
- do not copy the template wholesale as the business boundary

Exit criteria:

- protected panel app runs as a Worker boundary
- non-admitted requests fail closed
- the app shell can serve the frontend bundle plus health/readiness
- no hidden-admin path is added to `apps/supervisor-api`

### Phase 2. Origin Admission And Minimal Operator Context

Goal:

- make origin admission and operator identity projection explicit before any business-facing panel page ships

Deliverables:

- Access assertion validation middleware
- issuer, audience, expiry, and signature validation
- minimal operator context extraction
- request-scoped operator context for downstream BFF handlers
- normalized unauthorized / forbidden response handling

Minimum operator context:

- `operator_id`
- `principal_class`
- stable identity key such as email or subject
- minimal group / claim projection when available

Exit criteria:

- invalid or missing assertions are rejected at the Worker boundary
- operator identity is available to panel BFF handlers
- no local end-user auth system is introduced
- upstream protected access is treated as a prerequisite, not the final authorization result

### Phase 3. React Admin Shell

Goal:

- establish the protected panel UI shell with the minimum amount of custom chrome

Deliverables:

- `react-admin` app bootstrap
- open-source default `<Layout>` as the starting layout
- app-level `authProvider`
- app-level `dataProvider`
- route skeleton for the five long-term domains
- page-level guard strategy for custom routes

Implementation rule:

- `react-admin` may be used directly as the first UI shell
- it must not be allowed to define the Worker shell, auth model, or runtime seam

Exit criteria:

- panel routes render inside `<Admin>`
- auth checks are wired through `authProvider`
- data fetches go through `dataProvider`, not ad hoc direct fetch calls
- frontend routing stays compatible with Worker-hosted SPA delivery

### Phase 4. Worker-Local Hono BFF

Goal:

- create one explicit panel-facing API seam between the frontend shell and runtime APIs

Deliverables:

- `Hono` router for `/api/*`
- middleware composition for admission, operator context, trace propagation, and error shaping
- BFF adapters that call runtime APIs only
- pagination and filter translation for list views
- action endpoints for controlled operator operations
- explicit adapters for `apps/app-api` owned request projection APIs when `Requests` unlocks

Exit criteria:

- browser traffic only calls Worker-local `/api/*`
- BFF handlers never import `packages/*`
- upstream runtime API failures are normalized into panel-safe responses
- no direct package, database, object-store, or index coupling is introduced

### Phase 5. Read-Only MVP

Goal:

- ship a usable operator visibility layer before introducing write-capable flows

Recommended rollout order:

1. `Overview`
2. `Requests`

Rationale:

- `Overview` proves the shell, auth, summary fetch, and route protection with the least workflow complexity
- `Requests` adds the first meaningful operator troubleshooting surface

#### 5.1 Overview

Include:

- health/readiness summary
- recent failures or system alerts summary
- runtime/API version projection
- key dependency status where a safe runtime projection exists

Do not include:

- raw credentials
- internal config dumps

#### 5.2 Requests

Include:

- list and detail views by `request_id`, `conversation_id`, or related identifiers
- status and time filtering
- failure, clarification, and no-answer projections
- only data served from `apps/app-api` owned request projection APIs

Recommended shape:

- resource-like list/detail pages if the BFF can expose stable paginated projections

Hard rule:

- do not synthesize `Requests` from consumer chat persistence, raw audit files, or telemetry products

Exit criteria:

- the shipped read-only domains work through panel-local `/api/*`
- at least basic filter, pagination, and detail drill-down exist
- no mutation-capable flows are required for the MVP to be useful

### Phase 6. Jobs And Operations Re-Discussion

Goal:

- re-decide whether `Jobs` and `Operations` should exist in the first product rollout, and if so, with what narrower boundary

Status:

- delayed pending explicit discussion
- not part of the current implementation default path

Questions to close before implementation:

- should `Jobs` remain a first-rollout panel domain at all
- if `Jobs` remains, which runtime boundary owns its projections
- should `Operations` exist in the first rollout, or move behind a later milestone
- if `Operations` remains, which actions are safe enough to expose without panel drift

Until those questions are closed:

- do not implement `Jobs`
- do not implement `Operations`
- do not treat missing job/action runtime APIs as a reason to bypass runtime ownership

### Phase 7. Audit And Operator Safety

Goal:

- move the panel from merely usable to operationally trustworthy

Deliverables:

- `Audit` page
- operator action projections
- authorization failure projections
- key runtime event projections correlated to requests, jobs, and operations
- basic `canAccess` gating from principal class or claims
- second-confirmation posture for sensitive actions where needed

Do not do:

- turn audit into an unbounded raw-log browser
- fake governance closure that the repo has not actually implemented

Exit criteria:

- operators can review who did what and when
- sensitive failures are inspectable
- key actions are not black boxes

### Phase 8. Deployment, Observability, And Release Gate

Goal:

- make the panel safe to stage, verify, and release as a protected internal surface

Deployment deliverables:

- protected hostname and Route wiring
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

- staging UAT can run against a real protected surface
- release and rollback are explicit
- baseline operational observability exists

### Phase 9. Launch And Post-Launch Stabilization

Goal:

- move from successful staging to actual operator usage

Launch steps:

- run staging UAT with the real operator group
- fix first-round auth, UX, and projection gaps
- enable production route
- monitor the first-week usage pattern and failures
- close high-signal friction before expanding panel scope

First-week review focus:

- false reject or false allow in operator admission
- request and job projections sufficient for real troubleshooting
- operations too weak or too broad
- audit coverage sufficient for real accountability

Exit criteria:

- the operator group can use the panel for real troubleshooting and controlled actions
- no critical access, routing, or audit blind spot remains
- follow-up work is incremental, not architectural rework

## React Admin Mapping

Recommended mapping from `react-admin` primitives to this repo:

- `<Admin>`: protected panel shell
- default `<Layout>`: initial app chrome
- `authProvider.checkAuth`: operator access validation state
- `authProvider.getIdentity`: minimal operator context projection
- `authProvider.canAccess`: page and action gating from operator claims or principal class
- `dataProvider`: single frontend integration seam to Worker-local `/api/*`
- `CustomRoutes`: `Overview` first; other non-CRUD screens only after explicit scope confirmation
- resource pages: `Requests` and `Audit` when projections are list/detail friendly

## Runtime API Inventory Rules

Before implementation starts, the first panel-facing runtime API inventory must be explicit.

Minimum rules:

- each endpoint has a stable runtime owner
- the panel BFF may aggregate and reshape responses, but must not bypass runtime ownership
- if a capability does not yet have a safe runtime API, the panel does not read internal storage directly to obtain it
- browser code must never call runtime-owned internal surfaces directly

## Verification Strategy

Minimum checks before claiming the panel is product-ready:

1. unauthenticated or invalid-assertion requests are rejected before meaningful page render
2. browser network traffic stays on panel-local `/api/*`
3. panel code does not import `packages/*`
4. `Overview` works before any mutation-capable page ships
5. delayed domains are not smuggled back in through ad hoc routes
6. the protected hostname can be rolled back without reopening package boundaries

## Suggested Commit Cadence

For clean review history, the implementation should be split roughly as:

1. Worker shell scaffold
2. origin admission and operator context
3. `react-admin` shell and providers
4. `Overview`
5. `Requests`
6. `Audit`
7. deployment, smoke, and release-gate wiring
8. jobs and operations re-discussion, if still needed

## Main Risks

- The biggest delivery risk is an unclear runtime API inventory.
- The second risk is shipping `Jobs` or `Operations` before their scope is re-discussed and re-justified.
- The third risk is treating Cloudflare Access as final authorization instead of an origin-admission prerequisite.
- The fourth risk is allowing frontend or BFF code to bypass the Worker shell seam.
- The fifth risk is letting external templates define app structure before repo-owned boundaries are enforced.

## Critical Sequencing Rule

The implementation must keep this order:

1. Worker shell
2. origin admission
3. BFF seam
4. `react-admin` shell
5. read-only MVP
6. audit, deployment, and launch hardening
7. jobs and operations re-discussion only if they remain justified

If this order is inverted, the likely result is boundary rework rather than forward progress.

## Reference Documents

- `apps/protected-panel-web/README.md`
- `apps/protected-panel-web/REACT-ADMIN-REFERENCE.md`
- `docs/architecture/protected-panel-boundary.md`
- `docs/architecture/protected-panel-runtime-shell.md`
- `docs/architecture/protected-panel-operator-access.md`
- `docs/decisions/adr-0011-protected-panel-worker-runtime.md`
- `.planning/phases/04.4-protected-internal-panel-runtime-shell-inserted/04.4-IMPLEMENTATION-HANDOFF.md`
