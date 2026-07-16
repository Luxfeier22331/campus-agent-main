---
doc_type: runbook
truth_scope: ops
owner_boundary: source-collector
status: active
created: 2026-04-12
updated: 2026-07-16
---
# Internal Portal Authentication

## Runtime Model

The source-collector receives one external portal credential: the raw
`SSO_TGC` value. Kubernetes projects it from
`source-collector-internal-portal-auth/sso_tgc` to the file named by
`INTERNAL_PORTAL_SSO_TGC_FILE`.

The MUC environment configures:

```text
INTERNAL_PORTAL_BASE_URL=https://my.muc.edu.cn
INTERNAL_PORTAL_PAGE_URL=https://my.muc.edu.cn/page/11#/
INTERNAL_PORTAL_SOURCE_HOME_URL=https://my.muc.edu.cn
INTERNAL_PORTAL_SITE_ID=muc_internal_portal
INTERNAL_PORTAL_SSO_COOKIE_DOMAIN=.muc.edu.cn
INTERNAL_PORTAL_BYPASS_PROXY=true
```

`JSESSIONID`, `nginx` and Playwright storage state are worker-local derived
state. The worker seeds a Playwright browser context with `SSO_TGC`, follows
the provider's browser SSO flow and stores the resulting application session
under the writable `INTERNAL_PORTAL_RUNTIME_DIR`. A missing or changed TGC
causes bootstrap before collection. An expired application session causes one
browser refresh and one retry of the failed provider request.

The deployment creates `internal-portal-auth-maintenance` in a paused state.
The first successful credential replacement through Ops Web resumes it; from
then on Temporal runs it every 30 minutes. Each run discards derived application
cookies, starts with only the mounted TGC, observes a CAS Service Ticket,
establishes a new portal session and probes one notice row. A successful run
therefore proves that CAS used the TGT rather than only an existing portal
session.

The Secret is mounted as a complete volume, not with `subPath`. A Secret update
therefore reaches a running Pod through Kubernetes' eventually consistent
volume projection. Restarting the worker is not part of credential rotation.

## Deploy Without A Credential

Deploy ingestion-runtime and Ops Web before acquiring a TGC. During environment
bootstrap, create one empty Secret:

```bash
kubectl create secret generic source-collector-internal-portal-auth \
  --namespace "${NAMESPACE}"
```

The stable contract is:

```text
name: source-collector-internal-portal-auth
key:  sso_tgc
type: Opaque
```

Ops Web has `get` and `patch` permission for this resource name only. It cannot
create the bootstrap Secret, enumerate Secrets or modify another Secret.

The PostSync job creates the maintenance Schedule paused with the note
`awaiting initial credential`. Confirm ingestion-control, both workers, Ops Web
and the paused Schedule are healthy before asking a person to sign in. Do not
acquire a TGC while source merge, image publication or GitOps deployment is
still pending.

## Acquire And Activate

Only after the infrastructure above is ready, use a trusted operator
workstation:

```bash
pnpm --filter source-collector auth:save -- --output /tmp/internal-portal-sso-tgc
INTERNAL_PORTAL_SSO_TGC_FILE=/tmp/internal-portal-sso-tgc \
  pnpm --filter source-collector auth:check:notice
INTERNAL_PORTAL_SSO_TGC_FILE=/tmp/internal-portal-sso-tgc \
  pnpm --filter source-collector auth:refresh
```

The first command opens a visible browser, waits for the operator to complete
university SSO and writes only the raw TGC with mode `0600`. Neither command
prints the credential. The notice check is independent of the file-release
surface, which has its own `pnpm --filter source-collector
auth:check:file-release` command. `auth:refresh` forces a new CAS Service
Ticket and is the local equivalent of the maintenance Activity. Paste the
validated value into Ops Web immediately; the replacement operation resumes
the paused Schedule without restarting a worker.

## Rotate

Open `/internal-portal-auth` in Ops Web, paste either the raw `SSO_TGC` or a
Cookie string containing exactly one `SSO_TGC`, and replace the credential.
Only an admitted human operator can perform the update; service tokens are
rejected. Ops Web does not display, retain in PostgreSQL or log the value.

The API update and kubelet volume projection are eventually consistent. Ops
Web idempotently resumes a paused maintenance Schedule but does not trigger it
immediately; the next half-hour action runs after projection. A worker restart
is not required. Do not commit the TGC or encrypted copies of
each rotation to application or environment Git, or add it to Temporal
payloads, object-store artifacts, logs or PostgreSQL.

After volume projection, the next maintenance or capture Activity reads the
new file. A task that already ended with
`internal_portal_credential_expired` remains failed and is replaced by a new
task after credential delivery.

## Failure Handling

- `internal_portal_credential_unavailable`: the Secret file is missing, empty
  or malformed; initialize or replace it through the documented operation
  before submitting another portal task.
- `internal_portal_credential_expired`: browser SSO returned to the login page
  or did not issue a Service Ticket; the maintenance Schedule pauses. Acquire
  and replace the TGC in Ops Web, which resumes the Schedule.
- Provider throttling or transient network failure: keep the existing bounded
  Crawlee and Temporal retries.
- Object digest mismatch: fail the task and retain artifacts for diagnosis.

Missing portal credentials do not block other source-collector adapters. The
Secret volume is optional at Pod admission, while each internal-portal task
fails closed when its credential file is unavailable.

## Provider Constraint

Verified on 2026-07-15:

- browser SSO is owned by `https://ca.muc.edu.cn/zfca`;
- a valid TGC can repeatedly create browser Service Tickets and a working
  notice API session;
- CAS REST recognizes the TGT, but the portal service is reported as
  `service not registered or disabled` for REST Service Ticket issuance.

The maintenance Schedule can refresh a sliding inactivity window but cannot
extend a provider hard timeout. Temporal records each successful issuance and
the first credential failure. Ops Web reports the interval between credential
replacement, the last success and the first confirmed expiry with 30-minute
resolution. This is an observed validity interval, not the provider's declared
policy: proactive replacement, logout, password changes and administrative
revocation can shorten it. CAS REST, password automation and MFA automation
remain outside the provider contract.

## Related Documents

- `docs/runbooks/ingestion.md`
- `docs/contracts/file-release-export.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
