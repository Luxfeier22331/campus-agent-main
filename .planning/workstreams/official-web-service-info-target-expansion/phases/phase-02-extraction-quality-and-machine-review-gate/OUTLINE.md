---
doc_type: outline
status: planned
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Outline: Extraction Quality And Machine Review Gate

## Goal

Define the deterministic extraction, field coverage and machine review gate before any preview phase
records readiness verdicts.

## Planned Deliverables

- Machine review schema for contact directory and service guide field status.
- Blocker taxonomy for missing source facts, ambiguous owner, duplicate target, parser failure and
  unsupported page shape.
- Drift checks against target-source-map, consumer denominator and target inventory.
- `selected_write_requires_review` interpretation as ingestion-owned machine field review.
- Tests for ready and blocked candidates.

## Planned Checks

- No default manual approval state.
- Blocked candidates must carry source-backed reasons.
- Ambiguous facts cannot be silently promoted.
- Preview phases cannot emit readiness verdicts outside this gate.
