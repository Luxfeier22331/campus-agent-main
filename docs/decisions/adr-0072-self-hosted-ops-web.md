---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0072
status: accepted
created: 2026-07-11
updated: 2026-07-11
supersedes:
  - ADR-0055 single implementation surface for privileged runtime diagnosis
---

# ADR-0072 Self-Hosted Ops Web

## Context

`operator-console-web` runs on Cloudflare Workers and calls allowlisted `app-api` routes. That
boundary is appropriate for provider configuration and business operations, but complete runtime
diagnosis needs self-hosted PostgreSQL summaries, cluster health checks and locally retained logs
and traces.

Sending those reads through `app-api` would widen a browser-facing Worker API, duplicate an
internal observability backend and move database and OpenObserve credentials into the wrong
runtime. Letting the browser query the data sources directly would expose privileged credentials
and arbitrary query capability.

## Decision

Add `apps/ops-web` as a separate, self-hosted, read-only runtime diagnosis application.

- One Node/Hono process serves the React application and its fixed `/api/ops/*` endpoints.
- The server reads only allowlisted columns from four PostgreSQL summaries and writes only raw
  observability read audits.
- The server queries fixed OpenObserve streams with request-derived identifiers and bounded time
  windows. The browser cannot submit SQL or choose streams.
- Cloudflare Access plus application allowlists protect all Ops APIs. Raw logs and traces require
  a second, narrower allowlist.
- Temporal UI and Langfuse UI remain the complete native views for their systems. Sentry and Axiom
  remain external destinations where configured.
- `operator-console-web` remains the Worker surface for configuration and business operations; it
  does not proxy Ops Web or inherit its database and OpenObserve access.

ADR-0067 continues to govern `app-api` and the Worker Operator Console: they do not mirror external
sink bodies or query raw sinks. This ADR does not broaden that path. It creates a separate privileged
self-hosted boundary whose only purpose is runtime diagnosis.

ADR-0055 continues to govern the unified business operations concept and retirement of duplicate
domain back offices. This ADR supersedes only the assumption that privileged runtime diagnosis must
share the same Worker implementation.

Deployment follows ADR-0070. The source repository owns the application, image publication and
namespace-neutral base. Environment repositories own access coordinates, configuration, secrets,
network policy, ingress and immutable deployment selection.

## Consequences

- Operators use one additional application for deep runtime diagnosis; this is accepted to keep
  privileged data access out of the public Worker API.
- Ops Web has its own availability and credential lifecycle, but it does not become a general
  control plane or product backend.
- Request state remains PostgreSQL summary truth. OpenObserve and external platforms cannot change
  it.
- Raw observability access is auditable and fails closed when audit writes fail.
- A merged manifest or published image does not prove Ops Web is deployed or usable.

## Alternatives Considered

### Expand `app-api` and `operator-console-web`

Rejected. It would make a browser-facing Worker mediate internal database and observability access,
expand credentials and weaken the existing allowlisted API boundary.

### Add a separate `ops-api`

Rejected. Ops Web is the only consumer and Hono can serve the fixed API and static application in
one deployable unit.

### Use only Temporal, Langfuse, Sentry and Axiom UIs

Rejected. They do not provide one request-centered view of repo-owned status, service health,
Temporal queue summaries and locally available raw logs/traces, and external services may be
unreachable from the internal operations network.

### Let the browser query PostgreSQL or OpenObserve

Rejected. It would expose credentials and arbitrary query capability, and could not enforce the
server-side correlation and audit rules.
