# React Admin Reference

This note records what the repo should borrow from `react-admin` and what it should explicitly avoid while implementing `apps/protected-internal-panel`.

It is an app-local implementation reference, not a replacement for:

- `docs/architecture/protected-internal-panel-boundary.md`
- `docs/architecture/protected-panel-runtime-shell.md`
- `docs/architecture/protected-panel-operator-access.md`
- `docs/decisions/adr-0011-protected-panel-worker-runtime.md`

## Reference Scope

The upstream reference inspected in this worktree is the local clone under:

- `.tmp/react-admin-reference/`

The most relevant upstream files were:

- `packages/create-react-admin/templates/common/src/Layout.tsx`
- `examples/simple/src/index.tsx`
- `examples/simple/src/Layout.tsx`
- `examples/simple/src/authProvider.tsx`
- `examples/simple/src/dataProvider.tsx`
- `examples/simple/src/customRouteLayout.tsx`

## What To Borrow

### 1. Start From Default `<Layout>`

The starter template keeps layout customization minimal:

- use `react-admin`'s default `<Layout>`
- keep app-shell customization shallow at first
- only add panel-specific `AppBar`, `Menu`, or status widgets after the first operator flows are live

This matches the repo constraint that the panel should first prove its protected runtime seam and operator workflows, not spend early effort on a custom admin chrome.

### 2. Use `<Admin>` As The Shell, Not As The Architecture

The upstream `examples/simple/src/index.tsx` shows the right composition shape:

- `<Admin>` owns top-level app wiring
- `authProvider` owns access/session checks
- `dataProvider` owns data access abstraction
- `CustomRoutes` hosts non-resource pages

For this repo, that maps to:

- `<Admin>` as the protected panel shell
- resource pages for stable list/detail surfaces
- `CustomRoutes` for `Overview`, `Operations`, and other non-CRUD operator flows
- one shared query client for panel fetch/cache behavior

`react-admin` should remain a UI shell choice. It must not redefine the app boundary, origin admission model, or runtime API seam.

### 3. Treat `CustomRoutes` As First-Class

The protected panel is not a classic back-office CRUD app. The long-term domains are:

- `Overview`
- `Requests`
- `Jobs`
- `Operations`
- `Audit`

That means the implementation should not force everything into generic resource CRUD screens.

Recommended mapping:

- `Overview`: `CustomRoutes` page backed by panel summary endpoints
- `Requests`: resource-like list/detail pages if the runtime API returns paginated request projections
- `Jobs`: resource-like list/detail pages for job projections
- `Operations`: `CustomRoutes` pages or action panels for guarded operator actions
- `Audit`: resource-like list/detail views for audit projections

### 4. Map `authProvider` To Operator Admission, Not End-User Auth Product

The upstream `authProvider` shows the `react-admin` contract surface:

- `checkAuth`
- `checkError`
- `getIdentity`
- `canAccess`
- `login` / `logout`

For this repo, these concepts should map to the protected operator model:

- `checkAuth`: confirm the protected request already passed Worker-side origin admission
- `checkError`: react to expired or invalid operator access state
- `getIdentity`: expose minimal operator context only
- `canAccess`: gate pages/actions from operator claims or principal class
- `login` / `logout`: integrate with upstream protected access behavior when needed, not invent a local password system

The panel should not add self-serve signup, password reset, or profile management just to satisfy an admin-framework default shape.

### 5. Map `dataProvider` To Worker-Local BFF

The upstream `dataProvider` is the key pattern to reuse, but with a repo-specific constraint:

- the panel must call Worker-local `/api/*` routes
- those `/api/*` routes are backed by a Worker-local BFF
- the BFF talks to runtime APIs only
- the panel must not call `packages/*` or internal data stores directly

In practice, the first implementation should treat `dataProvider` as the single browser-side integration seam for:

- request/job/audit list and detail queries
- panel summary endpoints
- controlled operator actions
- pagination, filtering, and optimistic refresh behavior where appropriate

### 6. Use Page-Level Guards For Protected Surfaces

The upstream `customRouteLayout.tsx` uses `useAuthenticated()` before rendering a custom page.

That pattern is useful here for:

- `Overview`
- `Operations`
- any route that should fail closed before attempting data fetches

The panel should prefer explicit route/page guards over assuming that a hidden navigation item is sufficient protection.

## What To Avoid

- Do not treat the `Help Desk` demo as a template to clone wholesale.
- Do not start from `ContainerLayout` or `SolarLayout` before the first operator flows exist.
- Do not use `Appsmith` or `ToolJet` as the primary path.
- Do not let `react-admin` push the panel toward direct database/object-store access.
- Do not expose generic CRUD just because the framework makes it easy.
- Do not let frontend resource names become a backdoor contract for `packages/*`.

## Recommended First Composition

The first meaningful panel slice should look like:

- `react-admin` default `<Layout>`
- `CustomRoutes` for `Overview`
- one or two resource-like views for `Requests` and `Jobs`
- a Worker-local `Hono` BFF serving `/api/overview`, `/api/requests`, `/api/jobs`
- `authProvider` backed by protected operator context
- `dataProvider` backed only by panel-facing BFF routes

Only after this shape is stable should the app consider deeper shell customization.

## Help Desk Reference Boundary

`Help Desk` remains useful only as a reference for:

- information architecture density
- support-console navigation feel
- mixed list/detail/operator-action composition

It is not the source of truth for:

- runtime structure
- auth model
- data access model
- package coupling
- panel scope
