---
doc_type: state
status: active
created: 2026-04-28
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Official Web Collection Restart Closeout

## Current Status

- status: `active`
- current phase: `Phase 2 acceptance repair`
- owner: unassigned
- active implementation: closeout repair and acceptance review
- latest completed slice: official-web collector/app-api/ingestion handoff contract
  repair; local source-truth projection replay evidence remains artifact-only

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
  college single-host run. Both runs passed crawl artifact validation and QC.
  Replayed fixed projections now pass projection validation and chunk audit.
- `official-web-university-level-collection-dev-closeout` closed the
  university-core dev/local runner, preflight, repeated-run comparison,
  retention dry-run, alert summary, and import dry-run slice. That evidence is
  reconciled here as university-core dev-lane coverage, not full rollout or
  registry promotion.
- `apps/app-api` now consumes the `official-web-core` artifact type contract
  for official-web run artifact validation, including
  `dynamic_shell_discovery_audit`.
- `apps/ingestion-worker` official-web handoff promotion now derives
  collection-scoped `scope_refresh` targets from promotable projection
  documents instead of hard-coding only
  `official_web/muc_public_pages`.
- `apps/official-web-collector` default test command now runs Vitest with
  `--fileParallelism=false`, matching the stable collector gate.

## Latest Evidence

- projection replay:
  `.tmp/official-web-restart/official-web-restart-20260427T213902Z/projection-replay.json`
- projection validation:
  `.tmp/official-web-restart/official-web-restart-20260427T213902Z/projection-validation.json`
- projection output root:
  `.tmp/official-web-restart/official-web-restart-20260427T213902Z/stable-5host-projection`
- server-side official-web handoff batch:
  `.tmp/phase7-ingestion-acceptance/server/20260427T165723Z/official-web-small-batch-report.json`
- repair verification:
  `pnpm --dir apps/app-api test -- official-web-command.service.test.ts`
- repair verification:
  `uv run --all-packages python -m unittest tests.ingestion.test_official_web_handoff_consumer tests.ingestion.test_official_web_handoff_receiver tests.ingestion.test_official_web_university_collection_worker`
- repair verification:
  `pnpm --dir apps/official-web-collector test`
- repair verification:
  `pnpm --dir apps/app-api typecheck`

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
- original projection root:
  `apps/official-web-collector/.tmp/official-web-rollout/20260427T223542Z/university-core-projection`
- fixed projection root:
  `apps/official-web-collector/.tmp/official-web-rollout/20260427T223542Z/university-core-projection-fixed`
- crawl counters: `60` fetched, `0` failures, `3` hosts completed
- validator: `bundlePages = 60`, `errors = 0`, `warnings = 0`
- QC: `passPages = 60`, `reviewPages = 0`, `failPages = 0`
- projection: `60` emitted documents: `52` `muc_public_pages`, `8`
  `stable_reference`
- projection validator: `valid = true`, `errors = 0`, `warnings = 0`
- chunk audit on original projection: `passed = false`, with
  `stacked_short_label_lines = 17` and `article_section_over_aggregation = 1`
- chunk audit on fixed projection: `passed = true`, `issue_counts = {}`,
  `total_units = 431`, `total_chunks = 472`

College single-host crawl:

- run id: `college-law-20260427T223542Z`
- host: `law.muc.edu.cn`
- output root:
  `apps/official-web-collector/.tmp/official-web-rollout/20260427T223542Z/college-law`
- original projection root:
  `apps/official-web-collector/.tmp/official-web-rollout/20260427T223542Z/college-law-projection`
- fixed projection root:
  `apps/official-web-collector/.tmp/official-web-rollout/20260427T223542Z/college-law-projection-fixed`
- crawl counters: `26` fetched, `0` failures, `1` host completed
- validator: `bundlePages = 26`, `errors = 0`, `warnings = 0`
- QC: `passPages = 26`, `reviewPages = 0`, `failPages = 0`
- projection: `26` emitted documents, all `muc_public_pages`
- projection validator: `valid = true`, `errors = 0`, `warnings = 0`
- chunk audit on original projection: `passed = false`, with
  `stacked_short_label_lines = 5`
- chunk audit on fixed projection: `passed = true`, `issue_counts = {}`,
  `total_units = 27`, `total_chunks = 46`

## Completed Gaps

- `OFFICIAL-WEB-OPS-00A`: fixed official-web projection cleanup and chunk audit
  classification for the 20260427T223542Z university-core and `law.muc.edu.cn`
  runs. Evidence remains artifact-only local replay; it did not import/promote
  registry truth and did not change query-serving surface.
- `OFFICIAL-WEB-OPS-00B`: fixed closeout acceptance defects discovered during
  takeover review:
  app-api no longer hand-maintains a stale official-web artifact allowlist;
  dynamic-shell audit artifacts are accepted from the shared source-channel
  contract; official-web handoff promotion refreshes every promotable target
  collection represented in the projection; collector tests use the stable
  serial Vitest gate; official-web architecture links were corrected.
- `OFFICIAL-WEB-OPS-01` through `OFFICIAL-WEB-OPS-05`: reconciled as covered
  for the university-core dev lane by
  `official-web-university-level-collection-dev-closeout`. They are not
  evidence for college rollout, full recurring production operations, registry
  promotion, or query-serving opening.

## Repo-Tracked Seed Manifests

- `configs/ingestion/official_web/muc_public_pages/split-manifest.v1.json`: `24` documents
- `configs/ingestion/official_web/stable_reference/split-manifest.v1.json`: `9` documents
- `configs/ingestion/official_web/fresh_news/split-manifest.v1.json`: `8` documents
- `configs/ingestion/official_web/news_archive/`: runtime profile exists, no split manifest in repo

## Remaining Gaps

- `OFFICIAL-WEB-OPS-00`: fresh bounded crawl evidence exists, and fixed
  projection chunk audit now passes. Full rollout coverage widening remains
  outside this repaired slice.
- `OFFICIAL-WEB-OPS-06`: fresh no-promotion live seam evidence is still
  pending for
  `collector -> app-api lifecycle -> object storage -> handoff receiver ->
  ingestion staging`. Current projection evidence is still local artifact truth
  only, and registry import/promote truth has not been executed.

## Continuity Notes

- Keep `official-web-source-channel-news-opening` in backlog until product scope explicitly reopens
  news query-serving.
- Do not use this workstream to change retrieval runtime profile or product routing gates.
- Next implementation should start with a no-promotion live seam smoke. Do not
  promote registry truth or widen query-serving until that seam is proven and
  reviewed.
