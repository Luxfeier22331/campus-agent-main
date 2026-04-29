---
doc_type: index
status: active
created: 2026-04-27
updated: 2026-04-28
---

# Workstream: WeChat Official-Account Public Source Channel

这是 `wechat-official-account-public-source-channel` 的 native workstream 入口。
它负责把校园微信公众号公开文章 admission 为独立 source channel，并把采集内容作为
notice consumption 输入，而不是混入 `official_web` crawl policy、generic retrieval
或 authenticated notice portal。

## Current Status

- status: `active`
- current phase: `Phase 12`
- current focus:
  repo 内部链路已经恢复并收口为
  `FeedWe discovery -> real mp.weixin page capture -> canonical source-truth -> notice consumption`，
  并补齐了 `consumer_admission_batch_id`、runtime smoke、历史 audit/purge 与统一 shell。
  当前剩余工作是 live 历史坏数据修复、operator replay 验证与 acceptance evidence closeout。

## Reopen Basis

- FeedWe article detail page `/articles/{accountId}/{articleId}` 实际只展示标题、封面、
  摘要、作者与 `阅读原文` 按钮，不承载完整正文。
- `GET /api/articles/{articleId}` 当前只返回 metadata / summary / cover / source URL，
  不返回正文 HTML、inline images、OCR 或富投影字段。
- `POST /api/articles/download` 对已验证样本返回的 `article.html` 只有
  `无法提取文章内容` 占位正文。
- `POST /api/articles/download-local` 返回 zip，但其中 HTML 与上面的占位正文一致。
- 使用浏览器型 `Mozilla` `User-Agent` 访问真实 `mp.weixin.qq.com/s/...` 链接时，
  当前环境可拿到原始文章 HTML，并能观测到 `js_content` 与图片标记。
- repo 已冻结的 source-truth schema 本来就要求真实采集路径为
  `FeedWe discovery -> real mp.weixin article URL -> canonical source-truth`。

## Provider Selection

- selected discovery provider: `FeedWe authenticated web API`
- selected body capture source: real `mp.weixin.qq.com/s/...` article page
- docs: `https://feedwe.apifox.cn/390426961e0`
- runtime base URL observed from live service: `https://www.feedwe.top`
- current verified FeedWe endpoints:
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `GET /api/subscriptions`
  - `GET /api/articles`
  - `GET /api/articles/{articleId}`
  - `POST /api/articles/export`
  - `POST /api/articles/download`
  - `POST /api/articles/download-local`
- auth shape:
  - FeedWe web API: `Bearer` token from authenticated login
  - FeedWe API key: current web `/api/*` validation returned `401`; not an accepted primary auth path
  - WeChat article page fetch: browser-profile GET request, no repo-tracked credentials

The authenticated credentials are operator secret material and must not be
committed to the repo.
FeedWe remains the discovery provider only. It is not canonical source truth,
not the long-term audit boundary, and not a query-time runtime dependency.

## Notice Consumption Decision

Collected WeChat official-account articles enter the product as notice-family
content:

- source channel: `wechat_official_account`
- initial source family: `wechat_public_notice`
- intended downstream: notice consumption projection / notice read model
- initial target surface: public notice-level query candidates
- serving surface: admitted through `campus_notice_discover/get` source-family
  policy; only rows with real captured body and successful downstream
  materialization may become queryable

They do not enter:

- `official_web` crawl policy
- `authenticated_notice_portal`
- `regulations/*` direct materialization
- default public knowledge retrieval
- query-serving runtime outside explicit notice-family source-family admission

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- superseded historical closeout evidence:
  `./phases/phase-6-notice-source-family-serving-admission/SUMMARY.md`
  仅保留为 reopen 前的历史快照，不再代表当前 merged/worktree truth

## Archived Snapshot

- historical backlog snapshot:
  `../../../docs/plans/archive/historical/wechat-official-account-public-source-channel.md`
