---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Collector Candidate Gate

## Goal

Teach the collector to classify pages against the consumer denominator and retain only pages with
downstream value.

## Tasks

1. Add candidate matching after page extraction and page-family classification.
2. Attach consumer match metadata to retained page artifacts.
3. Treat listing pages as discovery-only unless they independently match a stable/contact/service
   denominator.
4. Add rejected reason counters for pages with no consumer match.
5. Add run report counters for fetched, parsed, retained, discovery-only, rejected and family
   counts.
6. Add unit tests with fixtures for contact card, service guide, stable reference, news and generic
   rejected pages.

## Candidate Evidence

- Contact: phone, email, office location or office hours plus owning label.
- Service: process, entry, material, contact, location or office-hours evidence plus service label.
- Stable reference: stable title/path/page family and no freshness-sensitive posture.
- News: article/news/event/notice shape, inventory-only.

## Verification

```bash
pnpm --dir apps/official-web-collector test
pnpm web:typecheck:affected
```

## Acceptance

- Generic official-web pages without consumer evidence do not become retained source-truth.
- Candidate counts appear in the run report.
- Existing source-truth artifacts remain valid for retained pages.
- No page is selected for ready read-model write during collector execution.
