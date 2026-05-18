---
doc_type: outline
status: planned
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Outline: Runtime Consumption Verification

## Goal

Verify released service-info projections are consumed by the intended runtime lookup surfaces.

## Planned Deliverables

- Focused runtime checks for `contact_directory_lookup`.
- Focused runtime checks for `service_guide_lookup`.
- App-api/operator projection evidence showing release task state and final structured data.
- Regression checks proving news/stable-reference surfaces were not opened accidentally.

## Planned Checks

- Lookup output includes source URL or source provenance where the contract requires it.
- Runtime queries do not read source-truth artifacts directly.
- Protected panel consumes only app-api projections.
