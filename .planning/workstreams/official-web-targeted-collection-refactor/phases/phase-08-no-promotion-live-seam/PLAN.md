---
doc_type: plan
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Plan: No-Promotion Live Seam

## Goal

Run and freeze a repeatable local/dev no-promotion seam for targeted official-web collection.

The seam must prove the target-first chain without writing current read models or retrieval aliases:

`collector -> app-api lifecycle -> object storage -> handoff receiver -> ingestion staging`

## Deliverables

- Repeatable smoke command or runbook for targeted official-web no-promotion execution.
- Evidence artifact containing:
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
- Tests or checks proving:
  - no broad crawl expansion occurs without target workset admission
  - ingestion reaches staged/no-promotion state
  - target-family and target-lineage report fields are present
  - protected app-api/panel route behavior remains app-api-owned

## Implementation Tasks

1. Inventory the current local/dev entrypoints for app-api lifecycle, collector workset execution, object storage, handoff receiver, and ingestion consumer.
2. Add or tighten a no-promotion smoke script if the current command does not assert Phase 6 target-lineage report fields.
3. Ensure the smoke emits a stable evidence JSON under the repo's intended evidence location, not root scatter files.
4. Run the seam with a target-workset input and confirm app-api ledger, object refs, handoff dispatch, and ingestion staging output agree on the same target job.
5. Document the frozen command and the proof fields in the Phase 8 summary.

## Non-Goals

- No registry promotion.
- No alias publish.
- No production scheduler rollout.
- No broad historical crawl.

## Acceptance

- Same target job can be rerun idempotently or with an explicit new run key.
- No broad crawl expansion occurs.
- Ingestion reaches staged/no-promotion state.
- Current read model and retrieval aliases do not change.
- Evidence includes Worker/app-api route behavior, not only local JSON files.

## Verification

```bash
pnpm --dir apps/app-api test:worker -- official-web
pnpm --dir apps/official-web-collector test
uv run --all-packages python -m unittest tests.ingestion.test_official_web_live_seam_no_promotion_script
```
