---
doc_type: index
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Workstream: Official Web Service Guide Consumption Quality Closeout

This workstream closes the quality gap between target-first `official_web` service-guide
collection and user-facing `service_guide_lookup` answers.

The workstream starts from the current accepted direction:

`official_web source-truth -> target-first service_guide_candidate -> ingestion-owned selected-write
release -> campus_services/service_guide projection -> service_guide_lookup`

It exists because recent no-promotion replay showed that extraction completeness has improved, but
query consumption quality is still not fully closed: VPN-like pages expose multiple procedure modes
as a flat `process_steps` list, tool answers concatenate too much, real source material still
contains shell/noisy rows, field-level provenance is not consistently surfaced, and release gates do
not yet measure product-answer focus.

## Current Status

- status: `active`
- current phase: `Phase 6 completed`
- current slice: official-web service-guide runtime closeout now covers focused planner routing,
  grouped-procedure deduplicated answer shaping, service-guide agent observability/guardrails, and
  default preview/runtime eval coverage for `entry` / `procedure` / `required_materials` /
  `contact` / `office_hours` / `eligibility`; next remaining proof is real no-promotion replay and
  isolated publish evidence
- owner: Codex session

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- gap review: `./GAP-REVIEW.md`
- phase plans: `./phases/`

## Boundary Notes

- This workstream does not reopen broad official-web crawl.
- This workstream does not open `fresh_news` or `news_archive`.
- This workstream does not add transaction execution, booking, submission or work-order behavior.
- This workstream does not move selected-write mutation into `apps/app-api`.
- This workstream does not make `service_catalog` a query-serving fallback.
- The runtime owner remains `campus-services-agent`; the data-plane owner remains
  `packages/ingestion-core` / `apps/ingestion-worker`.
