# official-web-collector

Collector runtime shell for the `official_web` source channel.

Current scope in this worktree:

- load a repo-tracked `official_web` site config
- validate the config through `official-web-core`
- emit a stable crawl plan for one `site_id`
  - including a lane-oriented `runIntent` such as `baseline` / `hot` / `repair`
- run a host-bounded Crawlee crawl for one `site_id`
- normalize fetched HTML into canonical page artifacts:
  - `capture/response.html`
  - `capture/response-headers.json`
  - `capture/fetch-metadata.json`
  - `provider/cheerio-basic/page-extraction.json`
  - `provider/cheerio-basic/discovered-links.jsonl`
  - `source-truth/page-manifest.json`
  - `source-truth/content-blocks.jsonl`
- write local run artifacts to an output directory:
  - `crawl-run.json`
  - `host-summary.json`
  - `url-results.jsonl`
  - `failures.jsonl`
  - `source-truth-bundle.json`
  - `quality-audit.json`
  - `page-observations.jsonl`
  - `dynamic-shell-discovery-audit.jsonl` for browser-assisted shell discovery
    runs
- optionally upload run artifacts plus page artifacts through an injected
  object-store boundary
- optionally call `app-api` control-plane `start / plans:resolve / heartbeat /
  finalize` through the frozen HTTP client

CLI entrypoints:

- `pnpm --dir apps/official-web-collector plan -- --site-id muc_public
  - -crawl-run-id manual-001`
- `pnpm --dir apps/official-web-collector crawl -- --site-id muc_public
  --crawl-run-id manual-001 --host <www.muc.edu.cn> --max-pages-per-host 5`
- `pnpm --dir apps/official-web-collector validate -- --output-dir
  .tmp/official-web/muc_public/manual-001`
- `pnpm --dir apps/official-web-collector qc-report -- --output-dir
  /tmp/official-web-smoke-news --json`

Collector runtime env for Docker / cron entrypoints:

- `OFFICIAL_WEB_APP_API_BASE_URL`: `app-api` control-plane base URL
- `OFFICIAL_WEB_SERVICE_TOKEN`: collector machine-to-machine token
- `OFFICIAL_WEB_RUN_INTENT`: optional default lane (`baseline` / `hot` /
  `repair`)
- `OFFICIAL_WEB_TRIGGER_TYPE`: optional default trigger (`manual` / `scheduled`
  / `replay`)
- `OFFICIAL_WEB_TRACE_ID`: optional trace correlation id
- object-store upload uses `OBJECT_STORE_SOURCE_ACCESS_KEY` /
  `OBJECT_STORE_SOURCE_SECRET_KEY` when present; otherwise it falls back to
  shared `OBJECT_STORE_ACCESS_KEY` / `OBJECT_STORE_SECRET_KEY`

For local live control-plane smoke:

- start `pnpm --dir apps/app-api dev` and use the actual `wrangler dev` port it
  prints, for example `OFFICIAL_WEB_APP_API_BASE_URL=<http://127.0.0.1:8790`>
- set `OFFICIAL_WEB_SERVICE_TOKEN` to the same value as `apps/app-api/.dev.vars`
  `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN`

CLI flags override env defaults for the same fields.

## Fixture And Regression Workflow

- checked-in extraction fixtures live under `test/fixtures/pages/`
- `test/page-artifacts.test.ts` covers source-truth extraction regressions:
  - default index canonicalization
  - page-family classification
  - directory/service-link demotion
  - aggregate card suppression
  - main-content link block emission
  - repeated-candidate marking
  - hidden placeholder suppression for dynamic-shell pages
  - heading-context leakage prevention
- these checked-in fixtures also serve as the small golden audit set for
  page-family and quality-signal regression
- `test/validate.test.ts` covers local output validation against
  `source-truth-bundle.json` and `quality-audit.json`
- `test/qc-report.test.ts` covers multi-run QC aggregation plus site-scoped
  shell-review allowlists

## Static-Fetch Boundary

`official-web-collector` 当前基线仍是静态 HTML fetch + Cheerio extraction。

这意味着：

- client-side rendered shell pages 可能只产出 `title` 或极少量静态占位文本
- extractor 会抑制 `display:none` / `height:0 + overflow:hidden` 这类隐藏占位节点，避免把它们误记为
  main content
- shell 页本身仍不直接作为正文页强行提取；默认应记为 static collector limitation，而不是在 extractor 里加入
  host-specific hack
- 对显式配置了 `dynamic_shell_discovery` 的 host，collector 可以用 browser-assisted
  discovery 发现同源列表/详情 URL，再把这些 URL 回灌到现有静态 source-truth lane
- `manual_requeue` 产物只负责把 promoted URL 落回静态 lane，不再继续作为通用 navigation frontier 扩张
- 这条能力不改变当前 source-truth contract：shell family 仍然保持 `manual_review`

## Local Output Validation

`pnpm --dir apps/official-web-collector validate` checks one local crawl output
directory and confirms:

- required run artifacts exist
- `source-truth-bundle.json` parses
- `quality-audit.json` parses
- each bundle page has matching local source-asset files
- bundle object keys match canonical `official_web/...` object-key derivation
- page manifest identity and response-body hash align with local files
- `content-blocks.jsonl` row count and row identity align with bundle/page
  manifest
- page-family consistency holds across bundle / page manifest / provider
  extraction / quality audit
- quality findings are reported separately from correctness failures:
  - correctness mismatches fail validation
  - quality review findings are surfaced as warnings

Use JSON output when integrating with another script:

```bash
pnpm --dir apps/official-web-collector validate -- --output-dir \
  /tmp/official-web-smoke-news --json
```

## QC Gate

`pnpm --dir apps/official-web-collector qc-report` aggregates one or more
validated crawl output directories into a source-truth QC gate.

Default gate semantics:

- correctness validation errors must stay at `0`
- `quality-audit` `failPages` must stay at `0`
- `review` pages fail the gate unless allowed by site `qc-policy.json` or
  explicit CLI override

Example:

```bash
pnpm --dir apps/official-web-collector qc-report -- \
  --output-dir /tmp/official-web-qc-20260331-news \
  --output-dir /tmp/official-web-qc-20260331-www \
  --output-dir /tmp/official-web-qc-20260331-xxgk \
  --output-dir /tmp/official-web-qc-20260331-xiaoyou \
  --output-dir /tmp/official-web-qc-20260331-lib \
  --json
```

This command is for source-truth extraction quality only. It does not claim
document/chunk correctness, retrieval relevance, or answer quality.

For repeatable smoke + audit steps, see [`docs/runbooks/official-web-collector-s
moke-and-audit.md`](../../docs/runbooks/official-web-collector-smoke-and-audit.m
d).
