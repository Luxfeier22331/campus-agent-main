---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-07-13
---
# App API Operator HTTP

## Ingestion Tasks

```text
GET /api/operator/ingestion/tasks
```

The route requires the existing operator principal and proxies validated query
parameters to ingestion-control's bounded operator projection. It does not
create, cancel, retry, or mutate ingestion tasks.

Supported filters are the ingestion-control projection filters for source,
target, registry task, run, status, and bounded limit. Invalid values use the
shared app-api error envelope.

The response contains no raw source content, object-store ref, provider
credential, Temporal history, or database owner field.

App-api has no authenticated-notice processing, official-web release-task, or
WeChat collector operator routes.

## Executable Sources

- `apps/app-api/src/app/routes/operator.ts`
- `apps/app-api/src/modules/integration/ingestion-control.ts`
- `docs/data/app-api/operator.md`
