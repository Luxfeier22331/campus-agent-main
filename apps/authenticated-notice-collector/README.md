# authenticated-notice-collector

Repo-local runtime shell for `authenticated_notice_portal` collection.

Current scope:

- auth bootstrap reuse
- portal API request context
- notice list/detail API fetch
- `文件发布` (`comsys-prompt-portlet-web`) list/detail/file-url API fetch
- auth-check preflight
- repo-local bootstrap bundle export for importer smoke
- repo-local file-release bundle export for authenticated portal
  file-publication capture
- portal taxonomy / selector snapshot export for both `notice` and
  `file_release`
- HTML-derived link observations plus detail `notice_annext` attachment refs for
  bootstrap export
- when `OBJECT_STORE_*` source-bucket credentials are configured, internal
  attachments are downloaded and uploaded into source object storage during
  bootstrap export
- when `OBJECT_STORE_*` source-bucket credentials are configured, released files
  from `文件发布` are also downloaded and uploaded into source object storage during
  file-release export
- source-bucket upload now prefers `OBJECT_STORE_SOURCE_ACCESS_KEY` /
  `OBJECT_STORE_SOURCE_SECRET_KEY`; if absent, it falls back to shared
  `OBJECT_STORE_ACCESS_KEY` / `OBJECT_STORE_SECRET_KEY`

Out of scope for this slice:

- document registry writes
- chunk/index release
- query-serving
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
pnpm file-release:export
```

Auth note:

- current collector auth bootstrap should treat `SSO_TGC@.muc.edu.cn` as the
  primary reusable login input
- operator refresh can set `AUTHENTICATED_NOTICE_SSO_TGC` to either the raw
  token value or a full `SSO_TGC=<value>; Path=/; Domain=.muc.edu.cn` cookie
  fragment; `auth:check` seeds `runtime/auth/storageState.json` from that value
  before attempting portal bootstrap
- collector now appends `muc.edu.cn`, `.muc.edu.cn`, `my.muc.edu.cn`,
  `ca.muc.edu.cn` into `NO_PROXY` / `no_proxy` at runtime so the portal path
  bypasses repo-local shell proxies by default
- when the local WSL direct DNS/network path is broken and the configured proxy
  is trusted for this authenticated portal session, set
  `AUTHENTICATED_NOTICE_BYPASS_PROXY=false`; this prevents the collector from
  adding the portal hosts to `NO_PROXY` and removes those portal hosts from the
  current process `NO_PROXY` value if already present; the collector also passes
  an explicit Playwright proxy to browser bootstrap and API requests using
  `AUTHENTICATED_NOTICE_PROXY_SERVER`, or `HTTPS_PROXY` / `HTTP_PROXY` /
  `ALL_PROXY` when the explicit value is empty
- `JSESSIONID` and `nginx` are portal-derived session cookies; the collector
  will first try visiting `<https://my.muc.edu.cn/page/11#/`> once before
  creating the API request context so these cookies can be refreshed at runtime
- browser launch and `page.goto` both share the same short bootstrap timeout
  window; if either step times out in headless mode, the collector falls back to
  the existing `storageState` cookies and lets the subsequent API request verify
  whether the session is still usable
- operator refresh should therefore prefer updating `SSO_TGC`; `auth:check` is
  responsible for verifying that the refreshed session can access both
  `/comsys-portal-notice-web/getNoticeByPage` and
  `/comsys-prompt-portlet-web/pageFile`
- `auth:check` now returns one readiness summary for `notice` and one for
  `fileRelease`; a session is only considered usable when both surfaces return
  non-empty samples

Attachment note:

- if `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_ACCESS_KEY`, and
  `OBJECT_STORE_SECRET_KEY` are configured, `bootstrap:export` materializes
  internal portal attachments and writes them into `OBJECT_STORE_BUCKET_SOURCE`
  (default `campus-rag-source`)
- if object-store credentials are absent, collector stays fail-closed on
  attachment materialization and exports `reference_only` attachment rows
  instead of pretending bytes were captured
- collector only owns attachment byte capture and source object upload; OCR,
  attachment routing, regulation promotion, and chunk/index work remain
  downstream ingestion responsibilities

Notice export note:

- `bootstrap:export` now snapshots the portal-wide `notice` selector truth from
  `/comsys-portal-notice-web/getNoticeSlects`
- `AUTHENTICATED_NOTICE_COLLECTION_MODE` controls the default list scan budget:
  - `incremental` uses each enabled notice type's incremental page budget
  - `backfill` uses each enabled notice type's backfill page budget
  - `selected` requires `AUTHENTICATED_NOTICE_SELECTED_NOTICES`
- `bootstrap:export` can also run a bounded historical notice refresh with
  `AUTHENTICATED_NOTICE_SELECTED_NOTICES`, using comma-separated
  `notice_id:notice_type[:notice_type_name]` entries. In this mode it fetches
  only those details and does not scan current list pages.
- when `AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL` is configured
  and `AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DISABLE` is not true, each
  successful export upserts a source-channel run ledger row with collection mode,
  selected notices, attachment outcome counts, local artifact paths, and source
  object artifact refs
- when source-bucket object-store credentials are configured, `bootstrap:export`
  uploads the exported bundle and manifest under
  `authenticated_notice_portal/runs/<site_id>/<timestamp>/`
- bootstrap manifest therefore includes:
  - `observed_notice_types`
  - `observed_organizations`
- these fields describe current portal taxonomy / org selector truth, not just
  the narrower repo-tracked live config in `config/notice-types.json`

File release note:

- `信息门户-文件发布` is not part of `/comsys-portal-notice-web`; it is a sibling
  authenticated surface exposed by `/comsys-prompt-portlet-web`
- collector exports this surface separately as `file-releases-bundle-*.json`
  plus `file-releases-manifest-*.json`
- the collector-owned export contract is frozen in
  `docs/reference/authenticated-notice-file-release-export-contract.md`
- each file-release manifest also snapshots current selector truth from:
  - `/comsys-prompt-portlet-web/getFileType`
  - `/comsys-prompt-portlet-web/getFileFileType`
  - `/comsys-prompt-portlet-web/getExplainDepts`
- manifest selector fields are:
  - `observed_file_types`
  - `observed_departments`
  - `observed_file_code_types`
  - `observed_explain_departments`
- the next authenticated export window should follow
  `docs/runbooks/authenticated-notice-file-release-auth-window-runbook.md`
- default export path is full `pageFile` traversal with `pageSize=100`;
  operators can bound it with:
  - `AUTHENTICATED_NOTICE_FILE_RELEASE_PAGE_SIZE`
  - `AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_PAGES`
  - `AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_ITEMS`
- released source files are stored under ADR-aligned keys:
  - `authenticated_notice_portal/file-release-{id}/{year}/sha256-{digest}/captur
    e/{filename}`
