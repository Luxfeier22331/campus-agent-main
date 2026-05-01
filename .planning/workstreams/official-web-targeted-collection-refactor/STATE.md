---
doc_type: state
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Official Web Targeted Collection Refactor

## Current Status

**Status:** active
**Current Phase:** Phase 0 ready
**Last Activity:** 2026-05-01
**Last Activity Description:** Review fixes applied to phase status, contract naming, broad crawl guard, source-handoff ownership, and verification gates

- owner: unassigned
- active implementation: Phase 0 planning only
- phase file posture: only Phase 0 has executable `PLAN.md`; Phase 1-9 are `OUTLINE.md` until promoted

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
- `configs/sources/official_web/muc_public/target-source-map.json` is loaded and
  validated by `official-web-core`, but current collector path does not use it as
  frontier owner.
- `apps/official-web-collector/src/crawl.ts` applies consumer-denominator after
  crawl and page dedupe.
- `apps/app-api` owns official-web run lifecycle, page freshness, outbox,
  operator query and handoff dispatch.
- `apps/ingestion-worker` consumes official-web handoff records and can stage or
  promote projection output, but current target lineage is not first-class job truth.

## Current Risk

Continuing to expand the existing collector would preserve a crawl-first design:

- allowed host would keep looking like collection target;
- target-source-map would remain advisory;
- consumer-denominator would remain a post-fetch filter;
- dynamic shell behavior would remain host-special-case;
- operator review would lack stable target job lineage.

## Current Plan

Execute `ROADMAP.md` from Phase 0 through Phase 9.

Immediate next work:

1. Phase 0: patch docs/config/tests and collector CLI/runtime admission so broad crawl default expansion is explicitly closed.
2. Phase 1: freeze target-source-map v2 and target job contract before changing runtime code.
3. Phase 1 must preserve canonical family names: `notice_news_candidate` for official-web collector retention and `official_web_public_notice` for notice consumption source family.

## Verification State

Planning-only consistency checks for this workstream:

```bash
pnpm docs:lint
git diff --check
gsd-sdk query workstream.status official-web-targeted-collection-refactor --raw --cwd "$PWD"
```

## Continuity Notes

- Do not reuse `official-web-collection-restart-closeout` as the implementation vehicle for this refactor.
- Keep `official-web-source-channel-news-opening` in backlog.
- Do not implement collector code before Phase 1 target contract is frozen.
- Treat source-handoff state machine as available supporting architecture, not as a blocker to target-first planning.
- Do not introduce `public_notice_inventory` as a new consumer/source family; use existing canonical names and document any inventory-only behavior as policy.
- Do not create a second artifact verification truth beside shared `SourceHandoff` / `SourceObjectRef` / `ObjectVerification`.
