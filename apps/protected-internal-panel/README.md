# protected-internal-panel

Protected internal panel runtime shell for campus-agent v2.

This app is an `apps/*` protected operator surface. It exists as a runtime shell only:

- it remains separate from `apps/supervisor-api`
- it consumes operator-facing runtime APIs only
- it does not import `packages/*` directly
- it stays fail-closed by default

The accepted request visibility path is:

`apps/protected-internal-panel -> apps/app-api -> request_projection`

This app is not the owner of request projection queries, and it must not treat `apps/supervisor-api` as its request list/detail API.

Current shell scope:

- `GET /healthz`
- `GET /readyz`
- `GET /`

The root route intentionally remains fail-closed until a protected delivery envelope and panel-facing runtime API inventory are explicitly wired.

Canonical references:

- `docs/architecture/protected-internal-panel-boundary.md`
- `docs/architecture/protected-panel-runtime-shell.md`
- `docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `docs/architecture/cloudflare-runtime-topology.md`

Environment:

- `PANEL_APP_NAME`
- `PANEL_RUNTIME_API_BASE_URL` (`apps/app-api` base URL)
- `PANEL_PROTECTED_HOSTNAME`
- `PANEL_PROTECTION_ENVELOPE`

This app does not close UI, business workflow, actor mapping, retrieval ACL, or audit semantics.
