---
doc_type: runbook
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-07-04
updated: 2026-07-04
---
# MUC Wiki Federation

## Boundary

This runbook owns repeatable staging operations for the `muc-wiki` federation
client.

It does not define the federation architecture or wire contract. Those remain in
`docs/architecture/system/mucwiki-login.md`,
`docs/architecture/system/identity-platform.md` and
`docs/contracts/app-api/federation.md`.

## Client Provision

Client secret values are runtime secret material. Do not commit them to docs,
source files, fixtures or examples.

Provision the staging client against the staging operator database:

```bash
APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET='<secret>' \
APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI='https://muc.wiki/wiki/'\
'Special:PluggableAuthLogin' \
APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI='https://muc.wiki/wiki/'\
'Special:UserLogout' \
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
pnpm --dir apps/app-api exec tsx ./scripts/run-with-staging-db-env.ts \
  pnpm exec tsx ./ops/identity/provision-muc-wiki-federation-client.ts
```

The command materializes the controlled `muc-wiki` client into app-owned
federation policy tables and Better Auth-owned OAuth provider tables.

## Verification

After provisioning, verify through the staging federation smoke path described
by `docs/runbooks/e2e-qa-release.md` or the relevant MediaWiki staging smoke.
Do not treat client provision alone as production login federation completion.
