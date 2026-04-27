---
doc_type: requirements
status: active
created: 2026-04-27
updated: 2026-04-27
---

# Requirements: WeChat Official-Account Public Source Channel

## Goal

Admit public WeChat official-account articles as a repo-owned source channel and
materialize them into notice-family consumption, with FeedWe as the selected
acquisition provider and existing MinIO-backed source bucket / control-plane
artifacts as the canonical handoff boundary.

## In Scope

- FeedWe provider contract and operator secret handling
- `wechat_official_account` source-channel admission
- public article capture from FeedWe into the existing MinIO-backed source bucket
- app-api run ledger / artifact refs / operator control-plane handoff
- source-truth schema for WeChat article units
- projection into notice consumption read model
- notice-family contract expansion for `wechat_public_notice`
- acceptance evidence for source replay, dedupe, and notice query readiness

## Non-goals

- 采集私信、群聊、登录态、会员内容或非公开内容
- 把 FeedWe、Apifox、浏览器缓存或 SaaS 面板作为 canonical truth owner
- 把公众号内容混进 `official_web` source channel
- 让 collector 直接写 document registry、Qdrant、release alias 或 query-serving runtime
- 在 notice consumption/read-model 未冻结前开放 public query-serving
- 把公众号文章直接升格为 `regulations/*` 或 `curriculum/*` 语义 owner

## Success Criteria

1. FeedWe provider selection, auth shape, endpoint contract, secret posture, and
   known limitations are documented.
2. `wechat_official_account` is modeled as an independent source channel with
   public article as the canonical source unit.
3. FeedWe output is mirrored into the existing MinIO-backed source bucket before
   downstream consumption.
4. `app-api` owns run ledger, artifact refs, and control-plane status; collector
   does not bypass it.
5. WeChat article source truth is replayable and provider-agnostic.
6. Notice consumption projection can ingest WeChat public notice candidates
   without rereading raw provider output at query time.
7. Cross-source dedupe is defined for WeChat article, official-web repost, and
   internal notice reference overlap.
8. No query-serving alias or runtime opening is created without explicit
   notice-family admission and acceptance evidence.

## Key Decisions

- FeedWe is selected as the current acquisition provider.
- FeedWe is not the canonical truth owner.
- WeChat public articles are notice-family content, not `official_web` pages.
- The first consumer is notice consumption, not generic knowledge retrieval.
- Provider secrets stay in environment/operator configuration and are never
  tracked.
