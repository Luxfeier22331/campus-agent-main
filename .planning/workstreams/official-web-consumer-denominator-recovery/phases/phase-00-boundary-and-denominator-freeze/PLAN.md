---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Boundary And Denominator Freeze

## Goal

Freeze the official-web consumer-denominator recovery boundary before code changes start.

## Tasks

1. Update workstream docs to state that recovery is consumer-driven, not broad crawl driven.
2. Record accepted consumer families:
   `contact_directory_candidate`, `service_guide_candidate`, `stable_reference_candidate`,
   `notice_news_candidate`.
3. Record non-goals:
   no full backfill, no registry promote, no serving alias update, no news/runtime opening.
4. Confirm relationship to `official-web-collection-restart-closeout` and backlog news opening.
5. Add Phase 0 summary with go/no-go decision for Phase 1.

## Files

- `.planning/workstreams/official-web-consumer-denominator-recovery/README.md`
- `.planning/workstreams/official-web-consumer-denominator-recovery/REQUIREMENTS.md`
- `.planning/workstreams/official-web-consumer-denominator-recovery/STATE.md`
- `.planning/workstreams/official-web-consumer-denominator-recovery/ROADMAP.md`

## Verification

```bash
pnpm exec markdownlint-cli2 --config .markdownlint-cli2.jsonc \
  .planning/workstreams/official-web-consumer-denominator-recovery/README.md \
  .planning/workstreams/official-web-consumer-denominator-recovery/REQUIREMENTS.md \
  .planning/workstreams/official-web-consumer-denominator-recovery/STATE.md \
  .planning/workstreams/official-web-consumer-denominator-recovery/ROADMAP.md
```

## Acceptance

- Workstream boundary is unambiguous.
- No existing serving surface is widened.
- Phase 1 can implement the denominator manifest without reopening architecture debate.
