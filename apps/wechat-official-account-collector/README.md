# WeChat Official-Account Collector

Collector runtime shell for the `wechat_official_account` public source channel.

Phase 2 responsibilities:

- call FeedWe authenticated web APIs:
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `GET /api/subscriptions`
  - `GET /api/articles`
- mirror article-list provider responses into the existing source bucket
- write ADR-0002 artifact families under:
  - `wechat_official_account/{account_slug}/{year}/{raw_version_id}/provider/feedwe/provider-response.jsonl`
  - `wechat_official_account/{account_slug}/{year}/{raw_version_id}/capture/feedwe-request-summary.json`
- materialize source-truth directly from authenticated article payloads
- report run metadata and artifact refs to `app-api`

It does not write source-truth, projections, document registry, Qdrant, release
aliases, notice read models, or query-serving runtime state.

## Local Command

```bash
pnpm --filter wechat-official-account-collector capture -- \
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
