---
doc_type: phase_outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Outline: Collector Executor Refactor

## Goal

Make collector execute app-api target worksets instead of deriving broad frontier from enabled hosts and seeds.

## Deliverables

- New collector execution mode: `target-workset`.
- Legacy crawl mode guarded as explicit operator/debug path.
- Workset-based request queue builder.
- Dynamic shell discovery attached to target job and promoted URLs only.
- Progress heartbeat counters grouped by target job and consumer family.
- Runtime compatibility path for old broad crawl must stay excluded from handoff, selected-write and promotion.

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
pnpm --dir apps/app-api test -- official-web-command
```
