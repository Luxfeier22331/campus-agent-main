---
doc_type: requirements
status: active
created: 2026-04-27
updated: 2026-04-28
---

# Requirements: WeChat Official-Account Public Source Channel

## Goal

Admit public WeChat official-account articles as a repo-owned source channel and
materialize them into notice-family consumption, with FeedWe as the selected
discovery provider and the real `mp.weixin.qq.com/s/...` article page as the
canonical body capture boundary before downstream notice consumption.

## In Scope

- FeedWe discovery-provider contract and operator secret handling
- `wechat_official_account` source-channel admission
- FeedWe article discovery into the existing MinIO-backed source bucket and
  control-plane ledger
- browser-profile fetch of the real `mp.weixin.qq.com` article page
- capture artifacts for request summary, page fetch metadata, and raw fetched HTML
- source-truth schema for WeChat article units
- fail-closed body-state semantics for verification pages, non-article pages,
  and parse failures
- inline image refs and downstream OCR handoff readiness
- projection into notice consumption read model
- notice-family contract expansion for `wechat_public_notice`
- acceptance evidence, replay, and drift guards against metadata-only truth regression

## Non-goals

- 采集私信、群聊、登录态、会员内容或非公开内容
- 把 FeedWe、Apifox、浏览器缓存或 SaaS 面板作为 canonical truth owner
- 把 FeedWe summary、FeedWe detail page、FeedWe placeholder download HTML 当作 canonical body
- 把公众号内容混进 `official_web` source channel
- 让 collector 直接写 document registry、Qdrant、release alias 或 query-serving runtime
- 在 notice source-family admission / read-model materialization 未冻结前开放
  public query-serving
- 为 `wechat_public_notice` 新建独立 query runtime 或独立 tool
- 在 query time 直接抓 live `mp.weixin` 页面
- 把公众号文章直接升格为 `regulations/*` 或 `curriculum/*` 语义 owner

## Success Criteria

1. FeedWe provider selection, auth shape, endpoint contract, secret posture, and
   known limitations are documented.
2. `wechat_official_account` is modeled as an independent source channel with
   public article as the canonical source unit.
3. FeedWe discovery output and real page capture artifacts are mirrored into the
   existing MinIO-backed source bucket before downstream consumption.
4. `app-api` owns run ledger, artifact refs, and control-plane status; collector
   does not bypass it.
5. WeChat article source truth is replayable and provider-agnostic.
6. Only real `mp.weixin` captured-body rows may become queryable notice rows;
   metadata-only or fetch-failed rows remain non-queryable references/audit rows.
7. Cross-source dedupe is defined for WeChat article, official-web repost, and
   internal notice reference overlap.
8. Image-heavy WeChat notices can enter downstream projection through inline image
   refs plus OCR-derived content, without polluting source-truth schema.
9. No query-serving alias or runtime opening is created without explicit
   notice-family admission and acceptance evidence.
10. `wechat_public_notice` query serving, once admitted, is implemented through
    `campus_notice_discover/get` source-family policy rather than a separate runtime.
11. Drift guards prevent reintroducing FeedWe summary/download placeholder content
    as primary body truth.

## Key Decisions

- FeedWe is selected as the current discovery provider.
- FeedWe is not the canonical truth owner.
- The real `mp.weixin.qq.com` article page is the canonical body capture boundary.
- WeChat public articles are notice-family content, not `official_web` pages.
- The first consumer is notice consumption, not generic knowledge retrieval.
- Provider secrets stay in environment/operator configuration and are never tracked.
- Query serving is a notice source-family policy decision, not a WeChat-specific
  runtime decision.
- OCR is a downstream notice-projection derivation step, not a source-truth field family.
