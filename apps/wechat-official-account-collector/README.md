# WeChat Official-Account Collector

Collector runtime shell for the `wechat_official_account` public source channel.

Current responsibilities:

- call FeedWe authenticated web APIs:
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `GET /api/subscriptions`
  - `GET /api/articles`
- mirror article-list provider responses into the existing source bucket
- write ADR-0002 artifact families under:
  - `wechat_official_account/{account_slug}/{year}/{raw_version_id}/provider/feedwe/provider-response.jsonl`
  - `wechat_official_account/{account_slug}/{year}/{raw_version_id}/capture/feedwe-request-summary.json`
- fetch real `mp.weixin.qq.com/s/...` article pages discovered through FeedWe
  through an internal Crawlee `CheerioCrawler` runner while preserving the
  existing parser output shape
- fetch cover and inline `mmbiz.qpic.cn` article media through an internal
  Crawlee `BasicCrawler` runner
- persist page fetch metadata, raw article HTML when available, parser
  extraction output, and captured media objects under the article capture prefix
- materialize source-truth from the real article page; verification walls,
  non-article pages, and fetch failures become explicit metadata-only terminal
  records
- write a run-level `capture-release.json` when an app-api run id exists
- optionally admit the release into `apps/ingestion-control`
- optionally report run metadata and artifact refs to `app-api` run ledger

It does not write projections, document registry, Qdrant, release aliases,
notice read models, or query-serving runtime state. Crawlee ownership is limited
to article page and media capture scheduling/retry; FeedWe login/auth,
subscription and article cursor APIs remain provider-adapter code, and
source-truth materialization/object-store writes remain outside Crawlee.
`app-api` is only a collector run ledger surface for this collector; it is not
the ingestion lifecycle handoff.

## Local Debug Entrypoint

This command is a local/operator capture helper. It is invoked directly instead
of being exposed as a package script, and it does not own release / alias
lifecycle.

```bash
pnpm --dir apps/wechat-official-account-collector exec node \
  --experimental-strip-types src/capture-cli.ts \
  --account "中央民族大学学生会" \
  --max-pages 2 \
  --max-articles 20
```

Required runtime config:

- `FEEDWE_EMAIL`
- `FEEDWE_PASSWORD`
- `FEEDWE_BASE_URL`
- existing `OBJECT_STORE_*` source-bucket config

Optional run ledger reporting:

- `WECHAT_OFFICIAL_ACCOUNT_APP_API_BASE_URL`
- `WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN`

Optional ingestion-control admission:

- `INGESTION_CONTROL_BASE_URL`

When both an app-api run id and `INGESTION_CONTROL_BASE_URL` exist, the CLI
writes
`wechat_official_account/{account_slug}/runs/{run_id}/capture-release.json`
and admits `wechat_public_notice/campus_notices/wechat_public_notice/
source_truth_materialize` with that object-store ref. Without
`INGESTION_CONTROL_BASE_URL`, capture still writes article source-truth and the
run ledger remains an audit surface only.
