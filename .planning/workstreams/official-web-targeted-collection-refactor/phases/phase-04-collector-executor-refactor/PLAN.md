---
doc_type: plan
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Collector Executor Refactor

## Goal

Make collector execute app-api target worksets instead of deriving broad frontier from enabled hosts and seeds.

## Deliverables

- New collector execution mode: `target-workset`.
- Legacy crawl mode guarded as explicit operator/debug path.
- Workset-based request queue builder.
- Dynamic shell discovery attached to target job and promoted URLs only.
- Progress heartbeat counters grouped by target job and consumer family.
- Runtime compatibility path for old broad crawl must stay excluded from handoff, selected-write and promotion.

## Implementation Tasks

1. Add explicit crawl execution mode to `crawlSite`: app-api control-plane runs use `target-workset`; legacy broad admission uses `legacy-broad-crawl`.
2. Make app-api admitted runs select hosts from returned workset rows, not local enabled hosts/seeds.
3. Change initial request construction so target-workset mode starts only from `plannerPages`.
4. Gate listing/dynamic-shell requeue to URLs that remain target-admitted through the workset lookup.
5. Include target job / consumer-family counters in progress heartbeat summary.
6. Keep legacy/debug runs visibly excluded via `legacy_contract_excluded`.

## Non-Goals

- No source-truth schema promotion yet beyond required metadata passed through.
- No panel changes.

## Acceptance

- Running collector with app-api configured fetches only URLs from resolved workset.
- Running collector without workset cannot silently crawl all enabled hosts.
- Existing static extraction artifacts are still produced for fetched pages.
- Dynamic shell discovery cannot widen outside admitted target job host/URL rules.
- Explicit legacy/debug mode writes a clear run admission decision that downstream gates can reject.

## Verification

```bash
pnpm --dir apps/official-web-collector test
pnpm --dir apps/official-web-collector typecheck
pnpm --dir apps/app-api test -- official-web-command
pnpm exec biome check apps/official-web-collector/src apps/official-web-collector/test
```
