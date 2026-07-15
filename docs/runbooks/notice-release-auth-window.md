---
doc_type: runbook
truth_scope: ops
owner_boundary: source-collector
status: active
created: 2026-04-12
updated: 2026-07-13
---
# Internal Portal Auth Window

## Purpose

Validate a newly acquired internal-portal session and use it for bounded
Temporal capture tasks before the session expires.

## Required Secrets

- `INTERNAL_PORTAL_SSO_TGC`
- `INTERNAL_PORTAL_SSO_COOKIE_DOMAIN`
- `INTERNAL_PORTAL_JSESSIONID`
- `INTERNAL_PORTAL_NGINX`
- source object-store access key and secret

Inject secrets into the source-collector worker. Do not place them in task
envelopes, object-store requests, Temporal memo/search attributes, logs, or
PostgreSQL.

A fresh worker Pod does not require a prebuilt storage-state file. When the
file is absent, the worker derives Playwright storage state from the explicit
cookie secrets in its writable `INTERNAL_PORTAL_RUNTIME_DIR`, with directory
mode `0700` and file mode `0600`. If neither a valid existing state file nor
explicit cookies are available, collection fails before provider requests.

## Precheck

From a trusted operator environment with the same provider configuration:

```bash
pnpm --dir apps/source-collector exec tsx adapters/internal-portal/src/auth-check.ts
```

Require successful notice and file-release samples. A failed auth check is not
a reason to start capture and rely on retries.

## Capture

1. Write an `internal_portal_notice_capture_request.v1` or
   `internal_portal_file_release_capture_request.v1` object to the source
   bucket.
2. Calculate SHA-256.
3. Submit a v3 task for `internal_portal.notice.capture` or
   `internal_portal.file_release.capture` through ingestion-control.
4. Inspect Temporal activity heartbeat and the bounded task projection.
5. Verify the terminal result-manifest digest and source object refs.

Use low request limits for the first task after rotating credentials. Increase
scope with a new task id only after the bounded capture succeeds.

## Failure Handling

- Authentication/SSO redirect: rotate credentials; do not retry indefinitely.
- Provider throttling/transient network failure: allow Temporal activity retry.
- Object digest mismatch: fail the task and retain artifacts for diagnosis.
- Partial file capture: keep explicit failed/reference-only rows; do not mark
  them source-ready.
- Expired auth during a run: let the task fail, rotate credentials, and start a
  new task id.

There is no collector run ledger or app-api command to repair manually.

## Related Documents

- `docs/runbooks/ingestion.md`
- `docs/contracts/file-release-export.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
