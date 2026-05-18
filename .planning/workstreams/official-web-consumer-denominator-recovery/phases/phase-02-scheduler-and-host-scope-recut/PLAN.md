---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Scheduler And Host Scope Recut

## Goal

Prevent routine official-web recovery from broad-crawling news or unrelated pages before the
consumer denominator is proven.

## Tasks

1. Recut `configs/sources/official_web/muc_public/scheduler-policy.json`.
2. Replace broad hot-lane news recovery with consumer-candidate collection lanes.
3. Keep college/topic hosts operator-triggered and one-host-at-a-time.
4. Add low page budgets for first consumer-denominator smoke runs.
5. Update tests and docs that assert lane identity or host filters.

## Expected Lane Shape

- consumer candidate smoke lane: enabled for bounded manual/local recovery
- university stable baseline lane: conservative, not broad news-first
- repair lane: retry only existing candidate failures
- college/topic single-host lanes: disabled templates
- news/fresh lane: disabled or inventory-only until runtime admission

## Verification

```bash
pnpm --dir apps/official-web-collector test
pnpm web:typecheck:affected
```

## Acceptance

- Default recovery no longer makes news crawl the main path.
- Any `news.muc.edu.cn` participation is either disabled, inventory-only or explicitly bounded by
  consumer candidate evidence.
- Scheduler policy records why broad collection is not the default.
