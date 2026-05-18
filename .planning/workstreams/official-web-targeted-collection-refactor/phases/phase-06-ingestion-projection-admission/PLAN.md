---
doc_type: plan
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Ingestion Projection Admission

## Goal

Make ingestion consume target lineage and produce the correct downstream candidate/review/release outputs.

## Deliverables

- Official-web replay reads target lineage from source-truth.
- Contact directory candidate projection remains review/selected-write gated.
- Service guide candidate projection remains review/selected-write gated.
- Stable reference projection remains release-gated.
- `notice_news_candidate` remains inventory-only and may map to `official_web_public_notice` source family for notice consumption.
- Promotion gate rejects inventory-only and missing target lineage.

## Implementation Tasks

1. Extend official-web source-truth ingestion parser/report types with target lineage fields.
2. Group replay reports by canonical target consumer family.
3. Add projection admission decisions for candidate-only, release-gated and inventory-only targets.
4. Fail selected-write/promotion admission when target lineage is missing or materialization policy is `inventory_only`.
5. Keep `public_notice_inventory` out of reports and downstream family names.

## Non-Goals

- No runtime opening for campus services.
- No fresh-news/news-archive opening.
- No direct registry current promotion in default no-promotion lane.

## Acceptance

- Targeted replay report groups output by target family.
- Consumer candidate review report includes source refs and evidence spans.
- Promotion with invalid inventory-only rows fails closed.
- Stable reference can still follow existing release gate.
- Replay does not emit `public_notice_inventory` as a new family in reports or downstream contracts.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_official_web_handoff_consumer tests.ingestion.test_official_web_projection_import
uv run --all-packages ruff check packages/ingestion-core apps/ingestion-worker tests/ingestion
```
