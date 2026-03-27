# protected-internal-panel

Protected internal panel runtime shell for campus-agent v2.

This app is an `apps/*` protected operator surface. It exists as a runtime shell only:

- it remains separate from `apps/supervisor-api`
- it consumes runtime APIs only
- it does not import `packages/*` directly
- it stays fail-closed by default
- it uses controlled operator access instead of a full end-user account system
- its long-term runtime is frozen to `Cloudflare Workers`
- its preferred UI shell is an open-source admin framework, with `react-admin` as the first-choice direction

Current shell scope:

- `GET /healthz`
- `GET /readyz`
- `GET /`

The root route intentionally remains fail-closed until a protected delivery envelope and panel-facing runtime API inventory are explicitly wired.

Canonical references:

- `docs/architecture/protected-internal-panel-boundary.md`
- `docs/architecture/protected-panel-operator-access.md`
- `docs/architecture/protected-panel-runtime-shell.md`
- `docs/decisions/adr-0011-protected-panel-worker-runtime.md`
- `.planning/phases/04.4-protected-internal-panel-runtime-shell-inserted/04.4-IMPLEMENTATION-HANDOFF.md`

Long-term operator access assumptions:

- Cloudflare Access or another controlled upstream identity source gates the protected hostname
- origin admission must validate `Cf-Access-Jwt-Assertion` or an equivalent signed access assertion
- the app maps only minimal operator context; it does not own self-serve signup, password reset, or profile management
- dynamic HTML/API responses remain fail-closed and non-public-cache by default

Long-term functional domains:

- `Overview`
- `Requests`
- `Jobs`
- `Operations`
- `Audit`

Environment:

- `PANEL_APP_NAME`
- `PANEL_RUNTIME_API_BASE_URL`
- `PANEL_PROTECTED_HOSTNAME`
- `PANEL_PROTECTION_ENVELOPE`

Future operator-access env contract is expected to add origin-admission values such as:

- access audience / issuer configuration for assertion validation
- operator identity claim mapping
- audit sink / trace projection configuration

This app does not close retrieval ACL, actor mapping, approval flow, or full governance semantics. It also does not exist to become a CMS, database console, or generic admin platform.
