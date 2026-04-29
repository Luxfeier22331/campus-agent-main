---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Summary: Chain Contract And Admission Design

## Completed Deliverables

- `CHAIN-CONTRACT.md`: froze the captured -> reset -> dry-run import -> source-truth / holding -> searchable -> admission -> downstream replay chain.
- `CONSUMER-ADMISSION-SCHEMA.md`: froze `search_only`, `downstream_admitted`, `defer`, `needs_multimodal`, and `invalid_capture` entry rules.
- `SEARCHABLE-NOTICE-LAYER-SCHEMA.md`: defined the universal searchable notice unit and provenance requirements.
- `DOWNSTREAM-BATCHING-POLICY.md`: restricted first replay targets to `regulation`, `transport_schedule`, and `service_status`.
- `DRY-RUN-REPORT-CONTRACT.md`: froze no-write rules and report shapes for reset, reimport, multimodal, and downstream replay.
- `fixtures/consumer-admission-fixture.v1.json`: covers all five consumption classes and the three allowed downstream targets.

## Decisions Frozen

- Phase 3 reset returns the system to `captured-but-not-imported`, not merely `imported-but-not-consumed`.
- Phase 3 must clear source-truth / holding / registry import rows while preserving source bucket objects, collector run ledger, and object locator evidence.
- `service_guide` cleanup is source-lineage based: stable PDF/handbook/campus-card rows are preserved, while notice-derived and smoke/stage/e2e/preview rows are reset.
- All valid captured notices must be represented in the consumer admission manifest and have a searchable destination.
- Downstream replay is blocked unless an entry is explicitly admitted to `regulation`, `transport_schedule`, or `service_status`.
- `needs_multimodal` entries are not target-ready until Phase 5 supplies normalized visual / attachment evidence.

## Next Phase Entry Conditions

Phase 3 can now implement reset dry-run / backup / execute using these frozen boundaries:

- keep captured source objects and collector run ledger.
- clear source-truth / holding / registry import rows for this replay baseline.
- clear old projection, read-model, admission, OCR/multimodal attempt, and typed downstream pollution.
- apply `service_guide` cleanup by source lineage rather than whole-table deletion.
