# authenticated-notice-collector

Repo-local runtime shell for `authenticated_notice_portal` collection.

Current scope:

- auth bootstrap reuse
- portal API request context
- list/detail API fetch
- auth-check preflight
- repo-local bootstrap bundle export for importer smoke
- HTML-derived reference-only link and attachment observations for bootstrap export

Out of scope for this slice:

- document registry writes
- chunk/index release
- query-serving
- attachment downloading or object upload ownership
- treating SQLite or export JSON as canonical system truth

Local commands:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm auth:save
pnpm auth:check
pnpm bootstrap:export
```
