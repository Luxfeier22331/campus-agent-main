---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-07-13
---
# App API Operator Data

App-api does not own source-processing lifecycle tables. The operator ingestion
route reads the bounded projection from ingestion-control:

```text
GET /api/operator/ingestion/tasks
-> ingestion-control /internal/ingestion/operator-projection/tasks
-> ingestion_control.tasks
```

The response contains task/source/target identity, terminal status, timestamps,
result presence, bounded summary/error, and Temporal workflow identity. It does
not expose object-store refs, raw source content, provider credentials, or
Temporal history.

There are no app-api `official_web`, `wechat_official_account`, authenticated
notice processing, source run, release-task, or collector ledger tables.

Online request diagnosis belongs to self-hosted Ops Web and its explicitly
allowed PostgreSQL/OpenObserve reads; it is not recreated in `operator.*`.

## Executable Sources

- `apps/app-api/src/app/routes/operator.ts`
- `apps/app-api/src/modules/integration/ingestion-control.ts`
- `apps/ingestion-control/src/postgres-store.ts`
