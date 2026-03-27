# protected-internal-panel

Protected internal panel runtime shell for campus-agent v2.

This app is an `apps/*` protected operator surface. It exists as a runtime shell only:

- it remains separate from `apps/supervisor-api`
- it consumes runtime APIs only
- it does not import `packages/*` directly
- it stays fail-closed by default

Current shell scope:

- `GET /healthz`
- `GET /readyz`
- `GET /`

The root route intentionally remains fail-closed until a protected delivery envelope and panel-facing runtime API inventory are explicitly wired.

Canonical references:

- `docs/architecture/protected-internal-panel-boundary.md`
- `docs/architecture/protected-panel-runtime-shell.md`
- `.planning/phases/04.4-protected-internal-panel-runtime-shell-inserted/04.4-IMPLEMENTATION-HANDOFF.md`

Environment:

- `PANEL_APP_NAME`
- `PANEL_RUNTIME_API_BASE_URL`
- `PANEL_PROTECTED_HOSTNAME`
- `PANEL_PROTECTION_ENVELOPE`

This app does not close UI, business workflow, actor mapping, retrieval ACL, or audit semantics.
