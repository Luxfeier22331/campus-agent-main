---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: State Machine Contract

## Goal

Freeze the source/media/fact/target state machine before implementation changes.

## Tasks

1. Create `NOTICE-INGEST-FACT-STATE-MACHINE.md` with the four-layer model.
2. Create `STATE-SCHEMA.md` with JSON shapes for:
   - source unit state
   - media role state
   - fact readiness state
   - target admission state
3. Create `TRANSITION-MATRIX.md` mapping valid transitions.
4. Create `REASON-CODES.md` with stable reason codes and owner layer.
5. Create `IDEMPOTENCY-POLICY.md` defining replay keys.
6. Add contract fixtures for all Phase 1 samples.
7. Add focused tests for schema and transition validation.

## State Rules

- `source_unit_state` cannot block a specific target because of unrelated pending media.
- `media_state` can block only fact groups that declare that media as required.
- `fact_readiness_state` must enumerate ready, partial and missing fact groups.
- `target_admission_state` is derived from fact readiness plus target policy.

## Acceptance Criteria

- Contract distinguishes `supplemental_media_pending` from `required_media_pending`.
- Contract has a reason code for body-complete facts.
- Contract can represent mixed text/OCR facts without losing provenance.
- Contract output is deterministic and idempotent.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_ingest_fact_state_contract -q
pnpm docs:lint
git diff --check
```
