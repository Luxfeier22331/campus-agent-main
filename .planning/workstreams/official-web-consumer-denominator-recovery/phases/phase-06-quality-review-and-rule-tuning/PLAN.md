---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Quality Review And Rule Tuning

## Goal

Review the first consumer-candidate batch for precision before any selected write.

## Tasks

1. Generate a review report from the no-promotion candidate projection.
2. Sample contact, service guide, stable reference and inventory-only notice/news candidates.
3. Classify each reviewed candidate as accept, reject, missing field or wrong family.
4. Tune denominator rules to reduce false positives.
5. Record known false negatives only as backlog unless they block current consumer surfaces.
6. Re-run focused tests and dry-run projection after tuning.

## Review Criteria

- Contact records need a contact label plus phone/email/location/hour evidence.
- Service records need a service subject plus process/entry/material/contact/location/hour evidence.
- Stable reference records must be long-lived and not freshness-sensitive.
- Notice/news records stay inventory-only.

## Verification

```bash
pnpm --dir apps/official-web-collector test
uv run --all-packages python -m unittest tests.ingestion.test_official_web_projection_validation
```

## Acceptance

- First batch precision is documented.
- Rule changes are deterministic and covered by tests.
- Remaining recall gaps do not cause broad crawl reopening.
