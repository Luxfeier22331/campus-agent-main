---
doc_type: index
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Workstream: Service Guide Lookup Question Coverage Hardening

This workstream hardens `service_guide_lookup` question coverage across planner routing,
structured runtime lookup, `campus-services-agent` answer shaping, `apps/app-api` public-chat
rendering and eval/release-gate evidence.

It starts from the current accepted runtime shape:

`app-api -> supervisor-api -> supervisor-agent-worker -> campus-services-agent -> service_guide_lookup -> PostgreSQL current projection / typed read model`

It exists because the core service-guide path is now implemented, but question coverage is still
too sparse for product confidence. We need a durable matrix that proves entry / procedure /
materials / contact / office-hours / eligibility / boundary questions route correctly, fail closed
when required fields are absent, and render user-facing answers without leaking source/projection
internals.

## Current Status

- status: `completed`
- current phase: `closed`
- current slice: Phase 0-6 completed; service-guide question matrix, routing, runtime lookup,
  answer shaping, app-api rendering, eval gate and representative public-chat subset evidence are
  closed for this workstream
- owner: current Codex session

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- question matrix: `./QUESTION-MATRIX.md`
- planning review: `./PLANNING-REVIEW.md`

## Boundary Notes

- This workstream only covers `service_guide_lookup` runtime question coverage and product-path
  answer contracts.
- This workstream does not reopen official-web broad crawl, handbook ingestion, selected-write
  release semantics, PostgreSQL projection architecture or service-guide source extraction.
- This workstream does not add query-time scraping, generic RAG fallback or supervisor-side
  service-guide answer generation.
- `source_refs` remain provenance. `entry_refs.url` is the user-facing action URL when an entry
  question asks "where / URL / link".
- Missing requested fields must fail closed at the field/focus level rather than dumping unrelated
  guide sections.
- Public/chat real-entry E2E evidence may be recorded here only for the service-guide subset; broad
  campus-services opening truth remains owned by `public-chat-campus-services-e2e-acceptance`.
- Runtime/agent missing-field cases may use synthetic fixtures. They must not be treated as a
  request to recollect source truth or import new service-guide records.

## Related Workstreams

- `campus-services-runtime-tool-gap-closeout`
  - owns the already completed tool-readiness baseline for all campus-services runtime tools.
- `official-web-service-guide-consumption-quality-closeout`
  - owns grouped-procedure extraction and selected-write quality closeout for official-web
    service-guide sources.
- `public-chat-campus-services-e2e-acceptance`
  - owns broad public/chat campus-services opening verdicts and staging drift evidence.
