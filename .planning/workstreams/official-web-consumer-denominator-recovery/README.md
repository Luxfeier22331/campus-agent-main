---
doc_type: index
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Official Web Consumer Denominator Recovery

This native workstream owns the recut of official-web collection recovery from
host/page broad crawl into consumer-denominator driven collection.

It answers a narrower question than the existing restart closeout workstream:

- which official-web pages should be retained because current downstream consumers can use them
- how collector, app-api, ingestion staging and selected write should prove that boundary
- how to avoid recreating large artifact-only inventories before the notice/news runtime is ready

## Current Status

- status: `completed`
- current phase: `Phase 8 closeout complete`
- current slice: consumer-denominator recovery implemented and locally verified
- active implementation: no
- owner: Codex session

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- denominator design: `./CONSUMER-DENOMINATOR-DESIGN.md`

## Phase Plans

- Phase 0: `./phases/phase-00-boundary-and-denominator-freeze/PLAN.md`
- Phase 1: `./phases/phase-01-consumer-denominator-manifest/PLAN.md`
- Phase 2: `./phases/phase-02-scheduler-and-host-scope-recut/PLAN.md`
- Phase 3: `./phases/phase-03-collector-candidate-gate/PLAN.md`
- Phase 4: `./phases/phase-04-consumer-first-projection-routing/PLAN.md`
- Phase 5: `./phases/phase-05-no-promotion-live-seam/PLAN.md`
- Phase 6: `./phases/phase-06-quality-review-and-rule-tuning/PLAN.md`
- Phase 7: `./phases/phase-07-selected-write-and-read-model-admission/PLAN.md`
- Phase 8: `./phases/phase-08-closeout-and-handoff/PLAN.md`

## Boundary Notes

- This workstream does not open `official_web/fresh_news` or
  `official_web/news_archive` as query-serving surfaces.
- This workstream does not promote broad official-web inventory into registry current truth.
- This workstream does not make listing pages answer-bearing evidence by default.
- This workstream does not let protected-panel-web read object storage, local artifacts or
  ingestion tables directly.
- This workstream does not replace authenticated notice consumption.
- This workstream may produce consumer candidates for `contact_directory`, `service_guide` and
  `official_web/stable_reference`; selected write requires explicit quality evidence.

## Implementation Result

- Added `consumer-denominator.json` for `muc_public`.
- Recut scheduler lanes to consumer-candidate recovery instead of broad news recovery.
- Added collector-side consumer match metadata, retained/rejected gating and counters.
- Added projection routing that emits `stable_reference` release candidates and keeps
  contact/service/news as candidate or inventory-only pages.
- Added projection validation for `consumer_candidate_pages`.
- Added handoff staging `consumerCandidateReview` and selected-write dry-run gate evidence.
- Kept registry promotion, serving alias refresh, `fresh_news` and `news_archive` closed.

Closeout evidence: `./CLOSEOUT.md`

## Relationship To Existing Workstreams

- `official-web-collection-restart-closeout` keeps the historical restart evidence and live seam
  gap record.
- This workstream owns the new consumer-denominator recut before more official-web collection is
  resumed.
- `official-web-source-channel-news-opening` remains backlog until product scope explicitly opens
  news or public notice runtime consumption.
