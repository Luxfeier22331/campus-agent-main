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
- read-only visual reference audit for finding real portal notices that contain
  `<img>`, lazy image, `srcset`, `<source>`, or inline style image refs before
  selected export smoke
- portal taxonomy / selector snapshot export for both `notice` and
  `file_release`
- HTML-derived link observations plus detail `notice_annext` attachment refs for
  bootstrap export; HTML discovery covers attachment anchors, `<img src>`,
  common lazy-image attributes, `srcset` / `<source>` responsive image refs, and
  inline `style=url(...)` image refs
- when `OBJECT_STORE_*` source-bucket credentials are configured,
  `bootstrap:export` uploads bundle / manifest handoff artifacts, while notice
  attachments remain reference-only unless an explicit attachment fetch request
  manifest admits specific refs
- when `OBJECT_STORE_*` source-bucket credentials are configured, released files
  from `文件发布` are also downloaded and uploaded into source object storage during
  file-release export
- source-bucket upload requires `OBJECT_STORE_SOURCE_ACCESS_KEY` /
  `OBJECT_STORE_SOURCE_SECRET_KEY`

Out of scope for this slice:

- document registry writes
- chunk/index release
- query-serving
- automatic `SSO_TGC` renewal
- treating SQLite or export JSON as canonical system truth

Local commands:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm auth:save
pnpm auth:check
pnpm collector:run
pnpm bootstrap:export
pnpm file-release:export
pnpm visual-ref:audit
```

Docker package:

```bash
docker build -f apps/authenticated-notice-collector/Dockerfile \
  -t campus-authenticated-notice-collector:local .

AUTHENTICATED_NOTICE_COLLECTOR_MODE=auth-check \
docker run --rm --env-file .env campus-authenticated-notice-collector:local
```

`AUTHENTICATED_NOTICE_COLLECTOR_MODE` accepts:

- `auth-check`
- `notice-export`
- `file-release-export`
- `visual-ref-audit`

The container entrypoint only routes to the existing package scripts. External
cron / systemd / Kubernetes Job owns scheduling.

Auth note:

- current collector auth bootstrap accepts an explicit three-cookie operator
  set:
  - `AUTHENTICATED_NOTICE_SSO_TGC`
  - `AUTHENTICATED_NOTICE_JSESSIONID`
  - `AUTHENTICATED_NOTICE_NGINX`
- the collector seeds those cookies into `runtime/auth/storageState.json`
  before attempting portal bootstrap and preserves them when headless bootstrap
  refresh drops one of the operator-provided cookies
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
- `auth:check` is responsible for verifying that the refreshed session can
  access both
  `/comsys-portal-notice-web/getNoticeByPage` and
  `/comsys-prompt-portlet-web/pageFile`
- `auth:check` now returns one readiness summary for `notice` and one for
  `fileRelease`; a session is only considered usable when both surfaces return
  non-empty samples

Attachment note:

- `bootstrap:export` records internal portal attachments, HTML-discovered
  attachment anchors, inline image refs, and allowlisted external inline visual
  refs as typed attachment refs. With object-store credentials, default byte
  capture is limited to inline visual refs because they can carry page-visible
  facts that are not present in extracted body text; set
  `AUTHENTICATED_NOTICE_DEFAULT_INLINE_VISUAL_CAPTURE=false` to force
  reference-only inline visuals.
- ordinary notice attachment bytes are fetched only when
  `AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH` points to an
  `authenticated_notice_attachment_fetch_request_manifest_v1` manifest built by
  the ingestion/operator side from source-truth retention decisions.
- only manifest rows with `fetch_to_quarantine`,
  `fetch_required_for_source_truth`, or `fetch_required_for_admitted_owner`
  become collector fetch admissions; `metadata_only` refs are not downloaded and
  do not count as required source objects.
- allowlisted external inline visual refs can be fetched by the same default
  inline visual capture path; the current default allowlist is `mmbiz.qpic.cn`,
  and those downloads use direct unauthenticated fetches instead of the portal
  API context or campus cookies.
- if object-store credentials are absent, collector stays fail-closed on
  source-bucket handoff for `bootstrap:export` / `file-release:export`; fixture
  collection helpers may still produce `reference_only` rows, but a successful
  collector run must have verified bundle and manifest object refs.
- collector only owns attachment byte capture and source object upload; OCR,
  attachment routing, regulation promotion, and chunk/index work remain
  downstream ingestion responsibilities

Visual reference audit note:

- `visual-ref:audit` is read-only: it scans notice detail HTML and writes a
  candidate report, but it does not download image bytes, upload objects, write
  run ledger rows, or import source truth
- default output path is
  `.tmp/authenticated-notice-visual-audit/<timestamp>/visual-reference-candidates.json`
- by default non-selected audit scans at most `50` notice details; override with
  `AUTHENTICATED_NOTICE_VISUAL_AUDIT_MAX_NOTICES`
- selected audit reuses `AUTHENTICATED_NOTICE_SELECTED_NOTICES`, so operators can
  audit a known notice before running `bootstrap:export`
- use the report to choose one real notice per pattern, then run selected
  `bootstrap:export` and import smoke to turn the candidate into live proof

Notice export note:

- `bootstrap:export` now snapshots the portal-wide `notice` selector truth from
  `/comsys-portal-notice-web/getNoticeSlects`
- `AUTHENTICATED_NOTICE_COLLECTION_MODE` controls the default list scan budget:
  - `incremental` uses each enabled notice type's incremental page budget
  - `backfill` uses each enabled notice type's backfill page budget
  - `selected` requires `AUTHENTICATED_NOTICE_SELECTED_NOTICES`
- full historical backfill can set
  `AUTHENTICATED_NOTICE_HISTORICAL_BACKFILL_MAX_PAGES_PER_TYPE` as the hard cap
  for each enabled notice type; the collector still stops early when the portal
  reports the last page, but it no longer relies on the repo default backfill
  page budget being large enough
- `bootstrap:export` can also run a bounded historical notice refresh with
  `AUTHENTICATED_NOTICE_SELECTED_NOTICES`, using comma-separated
  `notice_id:notice_type[:notice_type_name]` entries. In this mode it fetches
  only those details and does not scan current list pages.
- each notice row carries browser navigation metadata: `portal_print_url`,
  `notice_browser_url`, and `notice_browser_url_source`; these fields preserve
  the portal print route or API-provided external link without changing
  `notice_link` or notice identity
- when `AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL` is configured
  and `AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DISABLE` is not true, each
  export writes `started` then `success` / `failed` source-channel run ledger
  state with collection mode, selected notices, attachment outcome counts,
  verified source-bucket artifact refs, hash/size summary, and failure reason
- when `AUTHENTICATED_NOTICE_INGEST_QUEUE_ENQUEUE_ON_SUCCESS=true`,
  `bootstrap:export` invokes the repo-owned ingestion-worker enqueue command
  only after the collector run ledger row is `success` and `verified`. The
  collector does not write source-truth, projection, read model, chunk, index,
  or queue internals; it only hands off the verified `run_id`.
- historical collected content is not auto-enqueued by the collector; operators
  manually enqueue existing verified/repair ledger rows through the ingestion
  worker queue command when they decide to replay those captured runs.
- `AUTHENTICATED_NOTICE_INGEST_QUEUE_ENQUEUE_OUTPUT_DIR` optionally sets the
  enqueue evidence directory for that worker command.
- when `AUTHENTICATED_NOTICE_COLLECTOR_LEASE_DATABASE_URL` is configured and
  `AUTHENTICATED_NOTICE_COLLECTOR_LEASE_DISABLE` is not true, `bootstrap:export`
  acquires a `notice` run lease before writing artifacts; a live holder causes
  the run to fail closed
- when `AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH` is set,
  `bootstrap:export` loads that manifest before collection and fetches only the
  admitted attachment refs that appear in the selected or scanned notices
- when source-bucket object-store credentials are configured, `bootstrap:export`
  uploads the exported bundle and manifest under
  `authenticated_notice_portal/runs/<site_id>/<timestamp>/`
- local JSON exports are operator artifacts only; they are disabled by default
  and can be retained with `AUTHENTICATED_NOTICE_WRITE_LOCAL_EXPORTS=true`
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
- when source-bucket object-store credentials are configured,
  `file-release:export` uploads bundle / manifest under
  `authenticated_notice_portal/runs/<site_id>/<timestamp>/`
- when `AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL` is configured,
  `file-release:export` writes `started` then terminal
  `source_surface=file_release` run ledger state
- when `AUTHENTICATED_NOTICE_COLLECTOR_LEASE_DATABASE_URL` is configured,
  `file-release:export` acquires a separate `file_release` run lease
- released source files are stored under ADR-aligned keys:
  - `authenticated_notice_portal/file-release-{id}/{year}/sha256-{digest}/capture/{filename}`
- `file-release:export` fails closed when object-store mode cannot verify the
  released source file bytes for collected internal portal files

Production env notes:

- `AUTHENTICATED_NOTICE_COLLECTOR_LEASE_DATABASE_URL` enables Postgres-backed
  single-run admission for production collector jobs
- `AUTHENTICATED_NOTICE_COLLECTOR_LEASE_TTL_SECONDS` defaults to `3600`
- `AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL` enables bounded
  source-channel run ledger writes for both notice and file-release exports
- if the lease URL is absent, local runs continue without a lease; production
  jobs should configure the lease URL instead of relying on scheduler-only
  mutual exclusion
