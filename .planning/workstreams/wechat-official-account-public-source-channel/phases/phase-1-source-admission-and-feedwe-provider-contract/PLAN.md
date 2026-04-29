---
doc_type: plan
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 1: Source Admission And FeedWe Provider Contract

## Goal

Freeze the source-channel admission and provider boundary before implementing
capture. The outcome of this phase is a stable contract for using FeedWe as an
acquisition provider while routing collected public WeChat articles into notice
consumption.

## Decisions To Lock

1. Source channel:
   - name: `wechat_official_account`
   - source unit: public official-account article
   - not an `official_web` page and not an authenticated portal notice

2. Provider:
   - selected acquisition provider: `FeedWe`
   - docs: `https://feedwe.apifox.cn/390426961e0`
   - base URL observed: `https://feedwe.cloud`
   - verified endpoint: `GET /api/v1/articles/history`
   - auth header: `x-api-key`
   - secret must be environment/operator-owned and untracked

3. Downstream:
   - source family: `wechat_public_notice`
   - target: notice consumption projection / notice read model
   - no default query-serving opening in Phase 1

## Implementation Tasks

1. Update planning and registry.
   - Move the workstream from backlog to active.
   - Add native workstream files.
   - Keep the historical archive as a snapshot only.

2. Document provider evidence.
   - Record HTTP `200` validation without storing the API key.
   - Record returned field shape and observed sample account.
   - List unknowns: rate limits, retention, account scoping, delete/update
     posture, and provider SLA.

3. Define Phase 2 input contract.
   - Proposed env name: `FEEDWE_API_KEY`
   - Proposed MinIO source-bucket prefix follows ADR-0002:
     `wechat_official_account/{account_slug}/{year}/{raw_version_id}/...`
   - Proposed first artifact classes:
     `capture/`, `provider/`; `source-truth/` remains a later schema boundary

4. Define phase-D notice opening dependency.
   - `wechat_public_notice` must be added to notice-family contracts before
     query-time use.
   - Notice read model must consume materialized projection rows, not raw
     FeedWe responses.

## Acceptance Criteria

- Workstream appears as active in `.planning/WORKSTREAMS.md`.
- FeedWe selection is recorded without exposing secrets.
- Requirements and roadmap make notice consumption the downstream path.
- Phase 2 and Phase 4 dependencies are explicit.
- `pnpm docs:lint` passes.
