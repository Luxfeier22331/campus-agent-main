---
doc_type: state
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Official Web Targeted Collection Refactor

## Current Status

**Status:** completed
**Current Phase:** Phase 9 complete
**Last Activity:** 2026-05-01
**Last Activity Description:** Phase 9 legacy closeout and acceptance completed

- owner: unassigned
- active implementation: no
- phase file posture: Phase 0-9 have `SUMMARY.md`; workstream closeout recorded in `CLOSEOUT.md`

## Current Repo Facts

- `docs/architecture/domains/official-web/architecture.md` already defines
  `collector -> app-api control plane -> ingestion-worker` as the correct boundary.
- `docs/data/official-web-source-truth-schema.md` already freezes page-level
  `capture/` / `provider/` / `source-truth/` artifacts.
- `configs/sources/official_web/muc_public/hosts.json` currently has 35 hosts,
  with 33 enabled public hosts.
- `configs/sources/official_web/muc_public/scheduler-policy.json` narrows default
  enabled lanes to university-level hosts, but this is scheduler policy rather
  than first-class target admission.
- `configs/sources/official_web/muc_public/target-source-map.json` now uses target-first v2-compatible fields and is loaded into camelCase runtime model by `official-web-core`.
- `apps/official-web-collector/src/crawl.ts` now requires either `app-api` control-plane admission or explicit legacy broad crawl admission before it can execute crawl work.
- `apps/app-api` owns official-web run lifecycle, page freshness, outbox,
  operator query and handoff dispatch.
- `apps/ingestion-worker` consumes official-web handoff records and now reports
  target-family counts, target materialization policy counts and target lineage issues.

## Current Risk

Continuing to expand the existing collector would preserve a crawl-first design:

- allowed host would keep looking like collection target;
- target-source-map would remain advisory;
- consumer-denominator would remain a post-fetch filter;
- dynamic shell behavior would remain host-special-case;
- operator review would lack stable target job lineage.

## Current Plan

No active implementation remains in this workstream.

Reopen only if default official-web collection can again run from host/seeds without app-api target workset admission, target lineage stops reaching source-truth/app-api/ingestion reports, protected panel starts reading non-app-api official-web truth, legacy broad crawl can dispatch/promote without `legacy_contract_excluded`, or a new official-web downstream surface is admitted without target-source-map and no-promotion evidence.

## Verification State

Latest verified closeout checks:

```bash
pnpm --dir apps/app-api test -- official-web-command official-web-target-jobs
pnpm --dir apps/official-web-collector test -- crawl-workset-executor
pnpm --dir apps/app-api typecheck
pnpm --dir apps/official-web-collector typecheck
pnpm --dir apps/app-api test:worker -- official-web
uv run --all-packages python -m unittest tests.ingestion.test_official_web_live_seam_no_promotion_script
uv run --all-packages python scripts/official_web_live_seam_no_promotion.py --site-id muc_public --host xxgk.muc.edu.cn --target-id campus-services-service-guide --target-url https://xxgk.muc.edu.cn/info/1007/1113.htm --max-pages-per-host 1 --max-total-pages 1
pnpm --dir apps/official-web-collector test -- crawl-cli crawl-core
pnpm --dir apps/app-api test -- official-web-projection official-web-run-admission
pnpm docs:lint
```

## Continuity Notes

- Do not reuse `official-web-collection-restart-closeout` as the implementation vehicle for this refactor.
- Keep `official-web-source-channel-news-opening` in backlog.
- Do not implement collector code before Phase 1 target contract is frozen.
- Treat source-handoff state machine as available supporting architecture, not as a blocker to target-first planning.
- Do not introduce `public_notice_inventory` as a new consumer/source family; use existing canonical names and document any inventory-only behavior as policy.
- Do not create a second artifact verification truth beside shared `SourceHandoff` / `SourceObjectRef` / `ObjectVerification`.
