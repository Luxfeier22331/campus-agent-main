# authenticated-notice-collector

Repo-local runtime shell for `authenticated_notice_portal` collection.

Current scope:

- auth bootstrap reuse
- portal API request context
- notice list/detail API fetch
- `文件发布` (`comsys-prompt-portlet-web`) list/detail/file-url API fetch
- auth-check preflight
- repo-local bootstrap bundle export for importer smoke
- repo-local file-release bundle export for authenticated portal file-publication capture
- HTML-derived link observations plus detail `notice_annext` attachment refs for bootstrap export
- when `OBJECT_STORE_*` source-bucket credentials are configured, internal attachments are downloaded and uploaded into source object storage during bootstrap export
- when `OBJECT_STORE_*` source-bucket credentials are configured, released files from `文件发布` are also downloaded and uploaded into source object storage during file-release export
- source-bucket upload now prefers `OBJECT_STORE_SOURCE_ACCESS_KEY` / `OBJECT_STORE_SOURCE_SECRET_KEY`; if absent, it falls back to shared `OBJECT_STORE_ACCESS_KEY` / `OBJECT_STORE_SECRET_KEY`

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

- current collector auth bootstrap should treat `SSO_TGC@.muc.edu.cn` as the primary reusable login input
- collector now appends `muc.edu.cn`, `.muc.edu.cn`, `my.muc.edu.cn`, `ca.muc.edu.cn` into `NO_PROXY` / `no_proxy` at runtime so the portal path bypasses repo-local shell proxies by default
- `JSESSIONID` and `nginx` are portal-derived session cookies; the collector will first try visiting `https://my.muc.edu.cn/page/11#/` once before creating the API request context so these cookies can be refreshed at runtime
- browser launch and `page.goto` both share the same short bootstrap timeout window; if either step times out in headless mode, the collector falls back to the existing `storageState` cookies and lets the subsequent API request verify whether the session is still usable
- operator refresh should therefore prefer updating `SSO_TGC`; `auth:check` is responsible for verifying that the refreshed session can access both `/comsys-portal-notice-web/getNoticeByPage` and `/comsys-prompt-portlet-web/pageFile`
- `auth:check` now returns one readiness summary for `notice` and one for `fileRelease`; a session is only considered usable when both surfaces return non-empty samples

Attachment note:

- if `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_ACCESS_KEY`, and `OBJECT_STORE_SECRET_KEY` are configured, `bootstrap:export` materializes internal portal attachments and writes them into `OBJECT_STORE_BUCKET_SOURCE` (default `campus-rag-source`)
- if object-store credentials are absent, collector stays fail-closed on attachment materialization and exports `reference_only` attachment rows instead of pretending bytes were captured
- collector only owns attachment byte capture and source object upload; OCR, attachment routing, regulation promotion, and chunk/index work remain downstream ingestion responsibilities

File release note:

- `信息门户-文件发布` is not part of `/comsys-portal-notice-web`; it is a sibling authenticated surface exposed by `/comsys-prompt-portlet-web`
- collector exports this surface separately as `file-releases-bundle-*.json` plus `file-releases-manifest-*.json`
- the collector-owned export contract is frozen in `docs/reference/authenticated-notice-file-release-export-contract.md`
- the next authenticated export window should follow `docs/runbooks/authenticated-notice-file-release-auth-window-runbook.md`
- default export path is full `pageFile` traversal with `pageSize=100`; operators can bound it with:
  - `AUTHENTICATED_NOTICE_FILE_RELEASE_PAGE_SIZE`
  - `AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_PAGES`
  - `AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_ITEMS`
- released source files are stored under ADR-aligned keys:
  - `authenticated_notice_portal/file-release-{id}/{year}/sha256-{digest}/capture/{filename}`
