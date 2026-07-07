---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0067
status: accepted
created: 2026-06-30
updated: 2026-06-30
---
# ADR-0067: Ops Index And External Observability Sinks

## Context

The repository already uses external observability and LLM evaluation surfaces:
Sentry for errors/tracing, Axiom for logs/events/query dashboards, and Langfuse
for LLM traces, datasets, scores and review workflows.

Older operator observability documents described broad app-api-owned audit,
quality, safety and cost read models. That shape duplicates external platforms,
increases database scope and risks turning Operator Console into a custom
observability product.

## Decision

Adopt `Ops Index + External Sinks` as the operator observability architecture.

- `apps/app-api` owns only the minimal product Ops Index needed for launch
  triage: request identity, status, error code, timing, runtime health summary
  and safe sink correlation.
- Sentry, Axiom and Langfuse remain the detailed observability truth.
- Operator Console may show safe links or dashboard entries, but it must not
  copy external dashboard data, raw sink events, raw traces or raw LLM
  observations into app-api.
- External platform access is handled through the platforms' RBAC. The repo must
  not use a high-privilege service token to re-distribute sink data through
  Operator Console.
- If future operators need summary access without external platform accounts,
  that must be a new allowlisted curated-summary contract, not a revival of the
  broad audit/quality/safety/cost model.

## Consequences

- Broad operator quality, safety, cost, intent and standalone audit endpoints
  are not target architecture.
- Existing code or schema with those names is current-code residue until a
  separate cleanup task removes or narrows it.
- Operator Console remains a product operations surface, not an embedded
  Sentry/Axiom/Langfuse viewer.
- Langfuse remains the LLM observability and eval platform; app-api does not
  become a score or trace database.
- Worker and runtime smoke should verify that sinks receive data and can be
  correlated by request/trace id, not that app-api stores sink dashboard content.

## Alternatives Considered

### Keep broad app-api observability projections

Rejected. It duplicates external platforms and makes every dashboard field a
repo-owned schema/API commitment.

### Mirror external dashboards into app-api

Rejected. It bypasses external RBAC, creates stale cached observability state
and makes the backend responsible for vendor dashboard semantics.

### Link-only with no product Ops Index

Rejected. Operators still need the product to show whether a request failed,
which request failed and which correlation id should be used for sink lookup.
