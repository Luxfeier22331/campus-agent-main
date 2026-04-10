# authenticated-notice-collector

Repo-local runtime shell for `authenticated_notice_portal` collection.

Current scope:

- auth bootstrap reuse
- portal API request context
- list/detail API fetch
- auth-check preflight
- repo-local bootstrap bundle export for importer smoke
- HTML-derived reference-only link observations plus detail `notice_annext` attachment refs for bootstrap export

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

Auth note:

- current collector auth bootstrap should treat `SSO_TGC@.muc.edu.cn` as the primary reusable login input
- `JSESSIONID` and `nginx` are portal-derived session cookies; the collector now visits `https://my.muc.edu.cn/page/11#/` once before creating the API request context so these cookies can be refreshed at runtime
- operator refresh should therefore prefer updating `SSO_TGC`; `auth:check` is responsible for verifying that the refreshed session can access `/comsys-portal-notice-web/getNoticeByPage`
