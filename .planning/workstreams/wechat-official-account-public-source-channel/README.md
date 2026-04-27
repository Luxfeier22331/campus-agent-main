---
doc_type: index
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Workstream: WeChat Official-Account Public Source Channel

这是 `wechat-official-account-public-source-channel` 的 native workstream 入口。
它负责把校园微信公众号公开文章 admission 为独立 source channel，并把采集内容作为
notice consumption 输入，而不是混入 `official_web` crawl policy、generic retrieval
或 authenticated notice portal。

## Current Status

- status: `completed`
- current phase: `closeout`
- current focus:
  `Phase 6` 已完成 `wechat_public_notice` 通过统一
  `campus_notice_discover/get` source-family policy 进入 notice serving；
  reference-only get 与 read-model materialization 已通过本地真实链路验收。

## Provider Selection

- selected acquisition provider: `FeedWe`
- docs: `https://feedwe.apifox.cn/390426961e0`
- runtime base URL observed from docs: `https://feedwe.cloud`
- current verified endpoint: `GET /api/v1/articles/history`
- auth shape: `x-api-key`
- verification on 2026-04-27:
  - request with the operator-provided key returned HTTP `200`
  - response contained `articles`, `begin`, `count`, `hasMore`, `size`, `total`
  - sample article came from `中央民族大学学生会`

The API key is operator secret material and must not be committed to the repo.
FeedWe is only the acquisition provider. It is not canonical source truth,
not the long-term audit boundary, and not a query-time runtime dependency.

## Notice Consumption Decision

Collected WeChat official-account articles enter the product as notice-family
content:

- source channel: `wechat_official_account`
- initial source family: `wechat_public_notice`
- intended downstream: notice consumption projection / notice read model
- initial target surface: public notice-level query candidates
- serving surface: admitted through `campus_notice_discover/get` source-family
  policy with reference-only get semantics until article body capture exists

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
- final phase summary:
  `./phases/phase-6-notice-source-family-serving-admission/SUMMARY.md`

## Archived Snapshot

- historical backlog snapshot:
  `../../../docs/plans/archive/historical/wechat-official-account-public-source-channel.md`
