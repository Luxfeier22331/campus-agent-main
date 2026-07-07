---
doc_type: runbook
truth_scope: ops
owner_boundary: jobs/dining-sync
status: active
created: 2026-07-04
updated: 2026-07-04
---
# Dining Sync

## Boundary

This runbook owns repeatable dining catalog/review sync and published snapshot
verification steps.

It does not define dining logical schema or source truth. Those remain in
`docs/data/dining.md`. It does not define student HTTP response shape; that
belongs to `docs/contracts/app-api/dining.md`.

## Launch Path

The launch path is explicit:

```text
apply dining DB migrations
-> run jobs/dining-sync publish-catalog with production Feishu/Lark app credentials
   OR publish-catalog-from-observations if PG observations were already synced
-> run jobs/dining-sync sync-all for catalog + review sync
   (or pnpm --dir jobs/dining-sync sync, which invokes sync-all)
-> run jobs/dining-sync verify-published against the same DB
-> start app-api and campus-web against the same PG/object-store environment
-> verify /api/dining/halls and one floor/review route through campus-web
```

`apps/app-api` does not auto-import dining fixture data during startup and does
not fall back to fixture data if the published snapshot is missing. If a local
environment needs a catalog before Feishu/Lark credentials are configured, run
`import-dev-seed` as an explicit one-shot. Production must run `publish-catalog`.

`verify-published` is read-only and must not be treated as a sync or repair
command. Failures mean the preceding migration, sync, publish or object
projection steps need correction.
