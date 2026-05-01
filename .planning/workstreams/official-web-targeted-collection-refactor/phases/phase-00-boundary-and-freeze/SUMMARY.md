---
doc_type: summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Summary: Boundary And Broad Crawl Freeze

## Completed

- Closed the collector default broad-crawl path: `crawlSite` now requires either `app-api` control-plane admission or explicit legacy broad crawl admission.
- Kept `hostFilter` as a narrowing option only; it no longer creates collection scope without prior admission.
- Added explicit CLI flags for legacy/debug broad crawl:
  `--legacy-broad-crawl --legacy-broad-crawl-reason <reason>`.
- Normalized legacy/debug admission to `legacy_contract_excluded` so it is visibly outside handoff, selected-write, and promotion semantics.
- Updated official-web crawl policy and architecture docs to distinguish source capability registry from default collection target.
- Restored collector test fixtures to include `target-source-map.json`, matching the current official-web-core config contract.
- Added a repo-tracked scheduler guard asserting enabled non-repair scheduler lanes keep explicit host filters.

## Verification

```bash
pnpm --dir apps/official-web-collector test
pnpm --dir packages/official-web-core test
pnpm --dir apps/official-web-collector typecheck
pnpm --dir packages/official-web-core typecheck
```

All commands passed on 2026-05-01.

## Follow-Up

Phase 1 can now freeze the target-first declaration contract before app-api and collector workset runtime changes.
