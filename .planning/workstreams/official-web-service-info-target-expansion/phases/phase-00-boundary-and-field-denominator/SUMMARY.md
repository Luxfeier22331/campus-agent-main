---
doc_type: summary
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Summary: Boundary And Field Denominator

## Decisions

- Service-info expansion is limited to `campus_services/contact_directory` and
  `campus_services/service_guide`.
- `contact_directory_candidate` keeps the configured family denominator:
  `phone`, `email`, `location`, `office_hours`.
- `service_guide_candidate` keeps the configured family denominator:
  `service_process`, `service_entry`, `service_material`, `phone`, `location`,
  `office_hours`.
- Target inventory rows may add target-specific structured fields, but they may not relax
  family-level required evidence without changing the tracked denominator config in the same phase.
- `selected_write_requires_review` means ingestion-owned machine field review for this workstream,
  reported through `targetFieldReviews`; it is not a default human approval queue.

## Excluded Surfaces

- broad official-web crawl
- `official_web/fresh_news`
- `official_web/news_archive`
- stable-reference release unless directly required by service-info fields
- authenticated notice, WeChat, handbook PDF and public-docs source-channel work

## Ownership

- `apps/app-api` owns official-web control plane, operator-safe projections and read APIs.
- `apps/ingestion-worker` owns selected-write release execution and current structured projection
  mutation.
- protected panel reads app-api projections only.

## Verification Evidence

- `gsd-sdk query workstream.status official-web-service-info-target-expansion --raw --cwd "$PWD"`
  returned the workstream and Phase 0 as active.
- `git diff --check -- .planning/workstreams/official-web-service-info-target-expansion .planning/WORKSTREAMS.md`
  passed.
- `pnpm exec markdownlint-cli2 ".planning/workstreams/official-web-service-info-target-expansion/**/*.md" ".planning/workstreams/official-web-service-info-target-expansion/*.md"`
  passed.

Repo-wide `pnpm docs:lint` is currently blocked by an unrelated existing MD013 long-line finding in
`docs/architecture/system/retrieval-serving-architecture.md`.
