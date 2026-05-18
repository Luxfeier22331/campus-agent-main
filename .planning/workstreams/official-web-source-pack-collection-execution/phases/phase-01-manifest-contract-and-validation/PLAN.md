---
doc_type: plan
status: planned
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Manifest Contract And Validation

## Goal

Implement the source-pack manifest contract and fail-closed validation rules before any collection.

## Tasks

- Create the tracked source-pack manifest directory under
  `configs/sources/official_web/muc_public/source-packs/`.
- Freeze the canonical first-slice manifest path as
  `configs/sources/official_web/muc_public/source-packs/tool-driven-first-slice.v1.json`.
- Add a schema or typed validator for `tool-driven-first-slice.v1.json`.
- Validate required fields:
  - source pack id
  - entry id
  - site id
  - URL
  - content family
  - owner surface
  - release target
  - expected facts
  - capture policy
  - refresh posture
  - eval questions
- Add drift checks against `target-source-map.json` and `consumer-denominator.json`.
- Reject broad-crawl, news/fresh-news/news-archive and dynamic-shell answer-bearing rows.
- Validate that multi-owner rows can map each owner surface to a compatible release target.
- Reserve page-level replay status for Phase 4 replay reports, not manifest input.
- Add fixture tests for ready, blocked and invalid rows.

## Acceptance Criteria

- Invalid manifest rows fail closed with machine-readable reasons.
- Valid rows can be consumed by collector planning without host/seed inference.
- Validation explains optional source-not-provided fields without blocking.
- Validation supports multi-outcome rows such as service guide plus contact directory fan-out.
- Tests cover at least one service guide, contact, stable reference, composition component and
  excluded row.

## Verification

Recommended initial commands:

```bash
pnpm --dir apps/official-web-collector test
pnpm --dir apps/official-web-collector typecheck
```
