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
-> run `pnpm --dir jobs/dining-sync exec tsx ./src/cli.ts sync-all` for
   catalog + review sync
-> run jobs/dining-sync verify-published against the same DB
-> start app-api and campus-web against the same PG/object-store environment
-> verify /api/dining/halls and one floor/review route through campus-web
```

`apps/app-api` does not auto-import dining fixture data during startup and does
not fall back to fixture data if the published snapshot is missing. If a local
environment needs a catalog before Feishu/Lark credentials are configured, run
`import-dev-seed` as an explicit manual command. Production must run `publish-catalog`.

`verify-published` is read-only and must not be treated as a sync or repair
command. Failures mean the preceding migration, sync, publish or object
projection steps need correction.

K8s CronJob deployments consume the stable Secret name `dining-sync-secrets`.
Real secret material must be delivered through manual Kubernetes Secret,
SealedSecret, ExternalSecret or SOPS-encrypted Secret. Do not maintain plaintext
`secret.example.yaml` files under `infra/k8s/dining-sync/base`; the key
contract is documented in `infra/gitops/secrets/README.md`.
