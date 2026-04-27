---
doc_type: state
status: active
created: 2026-04-28
updated: 2026-04-28
---

# State: Official Web Collection Restart Closeout

## Current Status

- status: `active`
- current phase: `Phase 2`
- owner: unassigned
- active implementation: planning and ops follow-up only
- latest completed slice: local official web source-truth projection replay evidence,
  source-layer host split config, and fresh rollout crawl evidence

## Current Repo Facts

- Latest local projection replay emitted `85` official web documents.
- Latest local projection validation is valid with `errors = 0` and `warnings = 0`.
- Latest local projection split is `75` `muc_public_pages` documents and `10`
  `stable_reference` documents.
- Latest local projection did not emit `fresh_news` or `news_archive` documents.
- Current `.env` document registry has `0` records across
  `official_web/muc_public_pages`, `official_web/stable_reference`,
  `official_web/fresh_news` and `official_web/news_archive`.
- Current `.env` raw asset registry has `0` records across the same four official-web scopes.
- Server-side phase 7 official-web small batch consumed `0` handoff records.
- This evidence does not change serving surface status.
- `configs/sources/official_web/muc_public/hosts.json` now carries
  `host_group`, `owner_label`, and `rollout_order` for university-core,
  university-support, college, topic, and excluded hosts.
- `configs/sources/official_web/muc_public/scheduler-policy.json` now uses
  stable `lane_id` values and separates enabled university lanes from disabled
  one-host college/topic baseline lane templates.
- The host split is source-channel crawl segmentation only. It does not create
  `college_web`, reopen `fresh_news` / `news_archive`, or change product routing
  gates.
- Fresh rollout evidence now exists for enabled university-core hosts and one
  college single-host run. Both runs passed crawl artifact validation, QC, and
  projection validation, but both are blocked from promotion by chunk audit
  findings.

## Latest Evidence

- projection replay:
  `.tmp/official-web-restart/official-web-restart-20260427T213902Z/projection-replay.json`
- projection validation:
  `.tmp/official-web-restart/official-web-restart-20260427T213902Z/projection-validation.json`
- projection output root:
  `.tmp/official-web-restart/official-web-restart-20260427T213902Z/stable-5host-projection`
- server-side official-web handoff batch:
  `.tmp/phase7-ingestion-acceptance/server/20260427T165723Z/official-web-small-batch-report.json`

## Latest Projection Outcome

- emitted documents: `85`
- `muc_public_pages`: `75`
- `stable_reference`: `10`
- `fresh_news`: `0`
- `news_archive`: `0`
- errors: `0`
- warnings: `0`

## Fresh Rollout Evidence: 20260427T223542Z

These runs are artifact-only local evidence. They did not connect to `app-api`,
did not upload object-store artifacts, did not import/promote registry truth,
and did not change query-serving surface.

University-core bounded crawl:

- run id: `university-core-20260427T223542Z`
- hosts: `www.muc.edu.cn`, `news.muc.edu.cn`, `xxgk.muc.edu.cn`
- output root:
  `apps/official-web-collector/.tmp/official-web-rollout/20260427T223542Z/university-core`
- projection root:
  `apps/official-web-collector/.tmp/official-web-rollout/20260427T223542Z/university-core-projection`
- crawl counters: `60` fetched, `0` failures, `3` hosts completed
- validator: `bundlePages = 60`, `errors = 0`, `warnings = 0`
- QC: `passPages = 60`, `reviewPages = 0`, `failPages = 0`
- projection: `60` emitted documents: `52` `muc_public_pages`, `8`
  `stable_reference`
- projection validator: `valid = true`, `errors = 0`, `warnings = 0`
- chunk audit: `passed = false`, with `stacked_short_label_lines = 17` and
  `article_section_over_aggregation = 1`

College single-host crawl:

- run id: `college-law-20260427T223542Z`
- host: `law.muc.edu.cn`
- output root:
  `apps/official-web-collector/.tmp/official-web-rollout/20260427T223542Z/college-law`
- projection root:
  `apps/official-web-collector/.tmp/official-web-rollout/20260427T223542Z/college-law-projection`
- crawl counters: `26` fetched, `0` failures, `1` host completed
- validator: `bundlePages = 26`, `errors = 0`, `warnings = 0`
- QC: `passPages = 26`, `reviewPages = 0`, `failPages = 0`
- projection: `26` emitted documents, all `muc_public_pages`
- projection validator: `valid = true`, `errors = 0`, `warnings = 0`
- chunk audit: `passed = false`, with `stacked_short_label_lines = 5`

## Repo-Tracked Seed Manifests

- `configs/ingestion/official_web/muc_public_pages/split-manifest.v1.json`: `24` documents
- `configs/ingestion/official_web/stable_reference/split-manifest.v1.json`: `9` documents
- `configs/ingestion/official_web/fresh_news/split-manifest.v1.json`: `8` documents
- `configs/ingestion/official_web/news_archive/`: runtime profile exists, no split manifest in repo

## Remaining Gaps

- `OFFICIAL-WEB-OPS-00`: fresh bounded crawl evidence exists, but promotion /
  recurring coverage widening is blocked until chunk audit findings are fixed or
  explicitly reclassified.
- `OFFICIAL-WEB-OPS-00A`: resolve official-web chunk audit findings from the
  20260427T223542Z university-core and `law.muc.edu.cn` runs.
- `OFFICIAL-WEB-OPS-01`: dev/local scheduler entry still needs a documented command and repeated-run
  cadence.
- `OFFICIAL-WEB-OPS-02`: worker preflight should explicitly verify official web source channel
  readiness, writable target store and report directory behavior.
- `OFFICIAL-WEB-OPS-03`: repeated-run acceptance should prove projection / handoff batch
  idempotency or bounded duplicate handling across at least two consecutive runs.
- `OFFICIAL-WEB-OPS-04`: report retention needs a concrete age/count policy for local and future
  deployed runs.
- `OFFICIAL-WEB-OPS-05`: alerting needs concrete failure, zero-candidate and abnormal skip/error
  thresholds.
- `OFFICIAL-WEB-OPS-06`: registry import/promote handoff evidence is pending; current projection
  evidence is local artifact truth only.

## Continuity Notes

- Keep `official-web-source-channel-news-opening` in backlog until product scope explicitly reopens
  news query-serving.
- Do not use this workstream to change retrieval runtime profile or product routing gates.
- Next implementation should start with `OFFICIAL-WEB-OPS-00A` through
  `OFFICIAL-WEB-OPS-03` before adding alert/retention policy.
