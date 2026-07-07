# source-collector

Unified collector runtime for source-channel adapters that publish source-bucket
artifacts and ingestion-control task inputs.

Crawlee belongs inside this source adapter runtime. Collector code may emit
source-bucket artifacts, run ledgers and object-store task input refs, but
Crawlee request queues, storage handles and browser/crawler lifecycle must not
leak into ingestion contracts or runtime-neutral ingest helpers.

Current adapters:

- `internal-portal`
- `official-web`
- `wechat-official-account`

Runtime execution goes through scheduled jobs, Temporal activity workers or
explicit operator harnesses that call the adapter library functions. Package
scripts only expose verification lanes.

Container jobs use `apps/source-collector/Dockerfile` as a Crawlee-capable TSX
runtime image, not a default long-running API service. The image intentionally
has no default capture wrapper; a scheduler, Temporal worker or operator
harness must provide the exact module/function to run.

Optional ingestion-control admission is owned by the control plane after a
verified source-bucket capture release exists. App-api control-plane routes may
record source-channel operator projection, but they are not the ingestion
handoff owner.

For the internal-portal adapter, `authenticated_notice_collector_export_v2` and
the `ingestion_projection.authenticated_notice_collector_*` table names are
legacy persisted identifiers. Runtime env and code concepts use
`INTERNAL_PORTAL_*` names instead.

Verification:

```bash
pnpm --filter source-collector test
pnpm --filter source-collector typecheck
```
