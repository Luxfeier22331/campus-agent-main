# official-web-collector

Collector runtime shell for the `official_web` source channel.

This app loads repo-tracked site config, resolves a crawl plan, fetches bounded
public HTML pages, normalizes page artifacts and optionally uploads run/page
artifacts through the object-store boundary. It does not own downstream
document/chunk/index release truth.

## Local Debug Entrypoints

These entrypoints are local/operator debugging tools. They are invoked directly
instead of being exposed as package scripts, and they do not own production
release / alias lifecycle.

```bash
node --experimental-strip-types apps/official-web-collector/src/plan.ts \
  --site-id muc_public --crawl-run-id manual-001

node --experimental-strip-types apps/official-web-collector/src/crawl.ts \
  --site-id muc_public --crawl-run-id manual-001 \
  --host <www.muc.edu.cn> --max-pages-per-host 5

node --experimental-strip-types apps/official-web-collector/src/validate.ts \
  --output-dir .tmp/official-web/muc_public/manual-001

node --experimental-strip-types apps/official-web-collector/src/qc-report.ts \
  --output-dir /tmp/official-web-smoke-news --json
```

CLI flags override env defaults for the same fields.

## Runtime Env

- `OFFICIAL_WEB_APP_API_BASE_URL`
- `OFFICIAL_WEB_SERVICE_TOKEN`
- `OFFICIAL_WEB_RUN_INTENT`
- `OFFICIAL_WEB_TRIGGER_TYPE`
- `OFFICIAL_WEB_TRACE_ID`
- `OBJECT_STORE_SOURCE_ACCESS_KEY`
- `OBJECT_STORE_SOURCE_SECRET_KEY`

For local control-plane smoke, start `apps/app-api` and set
`OFFICIAL_WEB_SERVICE_TOKEN` to the same value as
`APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN`.

## Fixture And QC

- extraction fixtures live under `test/fixtures/pages/`
- `test/page-artifacts.test.ts` covers source-truth extraction regressions
- `test/validate.test.ts` covers local output validation
- `test/qc-report.test.ts` covers multi-run QC aggregation

`validate` checks local crawl artifacts and source-truth consistency. `qc-report`
aggregates validated outputs into a source-truth quality gate; it does not claim
document/chunk correctness, retrieval relevance or answer quality.

Client-side rendered shell pages may only expose a title or static placeholders.
The extractor suppresses hidden placeholder nodes and does not add host-specific
content hacks for shell pages. For hosts that explicitly configure
`dynamic_shell_discovery`, the collector may use Crawlee `PlaywrightCrawler` for
browser-assisted discovery and then promote same-host list/detail URLs back into
the static source-truth lane. `manual_requeue` artifacts only record promoted
URLs for that static lane; shell families remain `manual_review` unless the
source-truth contract admits them.

## Boundaries

Canonical source-channel, schema, crawl policy and lifecycle references:

- `docs/architecture/domains/official-web/architecture.md`
- `docs/data/official-web.md`
- `docs/policies/official-web-crawl-policy.md`
- `docs/runbooks/ingestion-control-clean-target.md`

The collector baseline is static HTML fetch plus Cheerio extraction. Explicit
dynamic-shell discovery may promote same-host URLs back into the static
source-truth lane, but shell pages themselves stay review-oriented unless the
source-truth contract admits them.
