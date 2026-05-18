---
doc_type: phase_outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Outline: No-Promotion Live Seam

## Goal

Run a real local/dev no-promotion seam for targeted official-web collection.

## Required Chain

`collector -> app-api lifecycle -> object storage -> handoff receiver -> ingestion staging`

## Deliverables

- Repeatable smoke command or runbook.
- Evidence artifact with:
  - target job ids
  - run id
  - fetched URL count
  - retained source-truth count
  - rejected/discovery-only count
  - uploaded object refs
  - handoff dispatch ref
  - ingestion execution status
  - projection/review report refs
  - proof that promotion/current truth was not written

## Non-Goals

- No registry promotion.
- No alias publish.
- No production scheduler rollout.

## Acceptance

- Same target job can be rerun idempotently or with explicit new run key.
- No broad crawl expansion occurs.
- Ingestion reaches staged state.
- Current read model and retrieval aliases do not change.
- Evidence includes Worker/app-api route behavior, not only node tests or local JSON files.

## Verification

```bash
pnpm --dir apps/official-web-collector validate -- --output-dir <run-output> --json
pnpm --dir apps/app-api test:worker -- official-web
uv run --all-packages python -m campus_ingestion_worker.official_web_handoff_consumer --limit 1
```

Final smoke command will be frozen after Phase 4 and Phase 6 implementation.
