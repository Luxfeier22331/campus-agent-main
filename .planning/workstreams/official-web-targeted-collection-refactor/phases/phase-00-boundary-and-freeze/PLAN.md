---
doc_type: plan
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Boundary And Broad Crawl Freeze

## Goal

Freeze the boundary between the old official-web closeout lane and this target-first refactor, then prevent default broad crawl expansion from being treated as an accepted path.

## Deliverables

- Docs update clarifying that broad host allowlist is source capability, not collection target.
- Config or test guard proving default official-web collection cannot expand to all enabled hosts without explicit operator/debug admission.
- Collector CLI / programmatic runtime guard proving `crawlSite` cannot silently derive a run from all enabled hosts without target workset admission or explicit legacy debug admission.
- Workstream state updated with the exact old-path posture.

## Scope

- `docs/architecture/domains/official-web/architecture.md`
- `docs/policies/official-web-crawl-policy.md`
- `configs/sources/official_web/muc_public/scheduler-policy.json`
- `apps/official-web-collector/src/crawl.ts`
- `apps/official-web-collector/src/crawl-cli.ts`
- `apps/official-web-collector/src/crawl-support.ts`
- focused collector/config tests

## Non-Goals

- No target-workset executor refactor.
- No app-api schema migration.
- No ingestion promotion.

## Required Runtime Guard

Phase 0 must close the current broad-crawl escape hatch before any later refactor:

- A default collector run without app-api target workset must fail closed.
- A run that intentionally uses legacy broad crawl must require an explicit operator/debug flag or equivalent explicit admission.
- `hostFilter` may narrow an admitted target or explicit legacy run; it must not create target scope on its own.
- Scheduler lane narrowing is not sufficient evidence because direct CLI/programmatic calls can bypass scheduler policy.

## Acceptance

- Broad crawl is documented as legacy/debug/operator-explicit only.
- Default scheduler lanes remain target recovery lanes, not full-site crawl lanes.
- Tests or config validation fail if a default enabled lane silently covers all enabled hosts.
- Collector tests fail if `crawlSite(siteId)` or the default CLI path expands to `plan.enabledHosts` without target workset admission or explicit legacy debug admission.
- Legacy debug/operator path is visibly excluded from handoff, selected-write and promotion semantics.

## Verification

```bash
pnpm docs:lint
pnpm --dir apps/official-web-collector test
pnpm --dir apps/official-web-collector test -- crawl
```
