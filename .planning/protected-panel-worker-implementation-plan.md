# Protected Panel Worker Implementation Plan

## Status

Planning only. This file records the preferred implementation sequence for `apps/protected-internal-panel` after the runtime and boundary decisions are already frozen.

It does not reopen:

- `Cloudflare Workers` as the panel runtime
- `react-admin` as the preferred UI shell direction
- `Hono` as the preferred Worker-local BFF direction
- `runtime APIs only` as the allowed integration seam

## Purpose

Implement a protected operator control plane under `apps/protected-internal-panel` that:

- remains a standalone `apps/*` runtime boundary
- stays fail-closed behind upstream protected access and origin assertion validation
- uses `react-admin` as the panel shell
- uses a Worker-local `Hono` BFF for panel-facing `/api/*`
- exposes only the operator domains already frozen in long-term docs

## Frozen Constraints

- The panel must not become `apps/supervisor-api` hidden admin mode.
- The panel must not import `packages/*` directly.
- Browser code must not call internal runtime surfaces directly.
- The Worker origin must validate `Cf-Access-Jwt-Assertion` or an equivalent signed access assertion.
- The panel is not a full user system, CMS, database console, object storage console, or arbitrary shell.

## Delivery Shape

Target runtime shape:

`authorized operator -> protected hostname -> Cloudflare Access -> Worker shell -> Hono BFF -> runtime APIs`

Target frontend shape:

`react-admin <Admin> shell -> authProvider -> dataProvider -> CustomRoutes/resources -> Worker-local /api/*`

## Implementation Phases

### Phase A. Worker Shell Baseline

Goal:

- turn `apps/protected-internal-panel` into the real Worker-hosted shell for the protected panel

Deliverables:

- Worker app entry and asset delivery setup
- panel-specific env contract for protected hostname and runtime API base URL
- fail-closed default handling for unknown/unprotected routes
- explicit separation from `apps/supervisor-api`

Exit criteria:

- protected panel app runs as a Worker boundary
- non-admitted requests fail closed
- app shell can serve the panel frontend bundle and health/readiness endpoints

### Phase B. Origin Admission And Operator Context

Goal:

- make origin admission and minimal operator context explicit before any business-facing panel page ships

Deliverables:

- Access assertion validation middleware
- issuer/audience/expiry validation
- minimal operator context extraction
- request-scoped operator context for downstream BFF handlers
- normalized unauthorized / forbidden response handling

Exit criteria:

- invalid or missing assertions are rejected at the Worker boundary
- operator identity is available to panel BFF handlers
- no local end-user auth system is introduced

### Phase C. React Admin Shell

Goal:

- establish the protected panel UI shell with the minimum amount of custom chrome

Deliverables:

- `react-admin` app bootstrap
- default open-source `<Layout>` as the starting layout
- app-level `authProvider`
- app-level `dataProvider`
- route skeleton for the five long-term domains

Exit criteria:

- panel routes render inside `<Admin>`
- auth checks are wired through `authProvider`
- data fetches go through `dataProvider`, not direct ad hoc fetch calls

### Phase D. Worker-Local Hono BFF

Goal:

- create one explicit panel-facing API seam between the frontend shell and runtime APIs

Deliverables:

- `Hono` router for `/api/*`
- middleware composition for admission, operator context, trace propagation, and error shaping
- BFF adapters that call runtime APIs only
- pagination/filter translation for list views
- action endpoints for controlled operator operations

Exit criteria:

- browser traffic only calls Worker-local `/api/*`
- BFF handlers never import `packages/*`
- upstream runtime API failures are normalized into panel-safe responses

### Phase E. Page Rollout

Recommended rollout order:

1. `Overview`
2. `Requests`
3. `Jobs`
4. `Operations`
5. `Audit`

Rationale:

- `Overview` proves the shell, auth, summary fetch, and route protection with the least workflow complexity.
- `Requests` adds the first meaningful operator troubleshooting surface.
- `Jobs` adds operational visibility without opening mutation-heavy flows too early.
- `Operations` only lands after read paths and audit posture are stable.
- `Audit` should ship once operator actions and request/job views have stable identifiers to project.

#### E1. Overview

Include:

- health/readiness summary
- recent failures or system alerts summary
- runtime/API version projection

Do not include:

- raw credentials
- internal config dumps

#### E2. Requests

Include:

- list and detail views by `request_id`, `conversation_id`, or related identifiers
- status/time filtering
- failure and clarification projections

Implementation note:

- use resource-like list/detail pages if the BFF can expose stable paginated projections

#### E3. Jobs

Include:

- ingestion/rebuild/eval/smoke job lists
- job detail projection
- retry history and failure summary when available

#### E4. Operations

Include:

- low-frequency controlled actions only
- explicit confirmation and audit hooks

Do not include:

- arbitrary shell execution
- arbitrary SQL
- generic internal API proxying

Implementation note:

- `CustomRoutes` is the preferred shape for operation consoles and guarded action pages

#### E5. Audit

Include:

- operator action projections
- authorization failure projections
- key runtime event projections correlated to requests/jobs/actions

Do not include:

- raw unbounded log browsing as the primary UX

## React Admin Mapping

Recommended mapping from `react-admin` primitives to this repo:

- `<Admin>`: protected panel shell
- default `<Layout>`: initial app chrome
- `authProvider.checkAuth`: operator access validation state
- `authProvider.getIdentity`: minimal operator context projection
- `authProvider.canAccess`: page/action gating from operator claims or principal class
- `dataProvider`: single frontend integration seam to Worker-local `/api/*`
- `CustomRoutes`: `Overview` and `Operations` first; other non-CRUD screens as needed
- resource pages: `Requests`, `Jobs`, and `Audit` when projections are list/detail friendly

## Runtime API Inventory

Before implementation starts, define the first panel-facing runtime API inventory explicitly.

Minimum recommended inventory:

- summary endpoints for `Overview`
- paginated request projection endpoints
- paginated job projection endpoints
- controlled operation endpoints
- audit projection endpoints

Inventory rules:

- each endpoint must have a stable runtime owner
- panel BFF may aggregate and reshape responses, but not bypass runtime ownership
- if a capability does not yet have a safe runtime API, the panel should not read internal storage directly to obtain it

## Verification Plan

Minimum verification for the first implementation slice:

- Worker-level tests for assertion validation and fail-closed behavior
- BFF tests for operator context handling and runtime API proxy/aggregation rules
- frontend tests for protected route rendering and data-provider integration
- end-to-end smoke for admitted and rejected operator access paths

Recommended milestone checks:

1. unauthenticated or invalid-assertion requests are rejected before page render
2. browser network traffic stays on panel-local `/api/*`
3. panel code does not import `packages/*`
4. `Overview` works before any mutation-capable page ships
5. controlled operations emit auditable identifiers

## Out Of Scope

- self-serve user management
- direct database or object-store browsing
- query-console style internal debugging backdoors
- generalized internal-tools builder behavior
- reopening Phase 5 governance decisions through the panel shell

## Reference Documents

- `apps/protected-internal-panel/README.md`
- `apps/protected-internal-panel/REACT-ADMIN-REFERENCE.md`
- `docs/architecture/protected-internal-panel-boundary.md`
- `docs/architecture/protected-panel-runtime-shell.md`
- `docs/architecture/protected-panel-operator-access.md`
- `docs/decisions/adr-0011-protected-panel-worker-runtime.md`
- `.planning/phases/04.4-protected-internal-panel-runtime-shell-inserted/04.4-IMPLEMENTATION-HANDOFF.md`
