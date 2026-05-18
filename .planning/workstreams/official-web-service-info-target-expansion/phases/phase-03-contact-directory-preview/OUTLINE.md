---
doc_type: outline
status: planned
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Outline: Contact Directory Preview

## Goal

Run no-promotion preview for accepted contact directory candidates using the Phase 2 machine review
gate.

## Planned Deliverables

- Preview run evidence for contact pages.
- Source object keys, raw asset ids and raw version ids.
- Extracted phone, email, location, office hours, organization and source provenance facts.
- Machine field review verdicts for each target.

## Planned Checks

- No current read-model write during preview.
- Missing target-level required fields fails readiness.
- Missing family-level evidence from `FIELD-DENOMINATOR.md` fails readiness unless config changes
  in the same phase.
- Source lineage must be sufficient for replay.
