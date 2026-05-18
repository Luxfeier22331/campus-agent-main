---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Consumer-First Projection Routing

## Goal

Route retained official-web pages by consumer family instead of relying on broad page-family
projection.

## Tasks

1. Extend official-web projection routing to consume candidate metadata.
2. Emit contact-directory candidate projection records for contact family matches.
3. Emit service-guide candidate projection records for service family matches.
4. Emit stable-reference release candidates only for stable reference matches.
5. Emit notice/news inventory-only records without read-model write.
6. Add validation that unsupported or missing candidate evidence cannot be promoted.

## Files To Evaluate

- `packages/ingestion-core/src/campus_ingestion_core/official_web_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/official_web_projection_engine.py`
- `packages/ingestion-core/src/campus_ingestion_core/official_web_projection_config.py`
- `packages/ingestion-core/src/campus_ingestion_core/service_guide_projection_curated.py`
- `packages/ingestion-core/src/campus_ingestion_core/contact_directory_projection.py`

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_official_web_projection \
  tests.ingestion.test_official_web_projection_validation
pnpm --dir apps/official-web-collector test
```

## Acceptance

- News/listing pages do not become answer-bearing by default.
- Contact/service candidate projections include source refs and extraction status.
- Stable reference candidates remain separated from service/contact structured read models.
- No registry current write is introduced in this phase.
