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
- report run metadata and artifact refs to `app-api`

It does not write projections, document registry, Qdrant, release aliases,
notice read models, or query-serving runtime state. Crawlee ownership is limited
to article page and media capture scheduling/retry; FeedWe login/auth,
subscription and article cursor APIs remain provider-adapter code, and
source-truth materialization/object-store writes remain outside Crawlee.

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

Optional app-api handoff:

- `WECHAT_OFFICIAL_ACCOUNT_APP_API_BASE_URL`
- `WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN`
