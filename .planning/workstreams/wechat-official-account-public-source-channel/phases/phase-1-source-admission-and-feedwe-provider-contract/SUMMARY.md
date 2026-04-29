---
doc_type: summary
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 1 Summary: Source Admission And FeedWe Provider Contract

## Outcome

Phase 1 is complete. The historical backlog item is now a native active
workstream, and its first phase froze the acquisition/provider/source-channel
boundary before implementation.

## Decisions

- Source channel: `wechat_official_account`
- Source unit: public WeChat official-account article
- Acquisition provider: `FeedWe`
- Provider docs: `https://feedwe.apifox.cn/390426961e0`
- Provider base URL: `https://feedwe.cloud`
- Verified endpoint: `GET /api/v1/articles/history`
- Auth header: `x-api-key`
- Secret keys:
  - `FEEDWE_API_KEY`
  - `FEEDWE_BASE_URL`
- Downstream source family: `wechat_public_notice`
- Downstream consumer: notice consumption projection / notice read model

## Evidence

- The operator-provided FeedWe API key was verified with a minimal request and
  returned HTTP `200`.
- The response shape contained `articles`, `begin`, `count`, `hasMore`, `size`,
  and `total`.
- The sampled response included a `中央民族大学学生会` public article.
- The API key itself was not written to tracked files.

## Boundaries

- FeedWe is acquisition only, not canonical source truth.
- Provider responses must be mirrored into the existing MinIO source bucket and
  app-api control-plane artifact refs before downstream processing.
- WeChat public articles do not become `official_web` pages.
- WeChat public articles do not enter `authenticated_notice_portal`.
- Query-serving remains closed until notice consumption/read-model and
  acceptance evidence are completed in later phases.

## Follow-up

Phase 2 should design and implement the capture/control-plane handoff:

- FeedWe request client and bounded capture command
- MinIO source-bucket artifact layout following ADR-0002
- app-api run ledger / artifact refs
- failure taxonomy and operator-visible status
- no direct document registry, Qdrant, or query runtime writes

Provider risks still requiring verification before production scheduling:

- rate limits
- account scoping
- retention guarantees
- article deletion/update semantics
- SLA and failure behavior
