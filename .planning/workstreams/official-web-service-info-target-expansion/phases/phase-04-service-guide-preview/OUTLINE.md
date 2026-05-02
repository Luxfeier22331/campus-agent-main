---
doc_type: outline
status: planned
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Outline: Service Guide Preview

## Goal

Run no-promotion preview for accepted service guide candidates using the Phase 2 machine review gate.

## Planned Deliverables

- Preview run evidence for service guide pages.
- Source object keys, raw asset ids and raw version ids.
- Extracted service name, responsible unit, service process, service entry, materials, phone,
  location, office hours and source provenance facts.
- Machine field review verdicts for each target.

## Planned Checks

- No current read-model write during preview.
- Missing target-level required fields fails readiness.
- Missing family-level evidence from `FIELD-DENOMINATOR.md` fails readiness unless config changes
  in the same phase.
- Optional presentation fields must be marked present, absent or source-not-provided.
