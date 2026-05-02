---
doc_type: roadmap
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Official Web Service Info Target Expansion

## Overview

This workstream plans a bounded expansion of official-web service information collection. It starts
from current downstream field gaps, admits only explicit source targets, freezes the field and
machine-review gate, runs no-promotion previews, then hands ready items to ingestion-owned
selected-write release tasks.

Future phases remain `OUTLINE.md` until the previous phase is summarized.

## Phase Status

- [x] **Phase 0: Boundary And Field Denominator** - Freeze surfaces, field requirements, non-goals
  and ownership boundaries.
- [ ] **Phase 1: Source Target Gap Inventory** - Compare current inventory/read models against the
  field denominator and nominate only source-backed target candidates.
- [ ] **Phase 2: Extraction Quality And Machine Review Gate** - Define deterministic field review,
  blocker taxonomy and `selected_write_requires_review` machine semantics before previews.
- [ ] **Phase 3: Contact Directory Preview** - Run no-promotion preview for accepted contact
  directory candidates and record source lineage plus machine field review verdicts.
- [ ] **Phase 4: Service Guide Preview** - Run no-promotion preview for accepted service guide
  candidates and record source lineage plus machine field review verdicts.
- [ ] **Phase 5: Selected-Write Release Handoff** - Prepare ingestion-worker release task inputs
  for ready candidates without moving mutation into app-api.
- [ ] **Phase 6: Runtime Consumption Verification** - Verify `contact_directory_lookup` and
  `service_guide_lookup` consume released projections through app-api/supervisor paths.
- [ ] **Phase 7: Closeout** - Record accepted targets, blocked targets, verification evidence and
  reopen rules.

## Implementation Dependency

1. Phase 0 freezes denominator and boundaries before target expansion.
2. Phase 1 may only add candidates that satisfy Phase 0 scope.
3. Phase 2 depends on explicit accepted candidates and denominator alignment.
4. Phase 3 and Phase 4 depend on Phase 2 machine review gate and no-promotion collector path.
5. Phase 5 depends on ready candidates with source lineage and field verdicts.
6. Phase 6 depends on selected-write materialization.
7. Phase 7 closes only after runtime consumption evidence and blocked-target records exist.

## Promotion Rule

- Promote exactly one future phase outline to `PLAN.md` when it becomes executable.
- Do not promote a future phase until the previous phase has `SUMMARY.md`.
- Before structural changes, re-check:
  - `docs/architecture/domains/official-web/architecture.md`
  - `docs/data/official-web-source-truth-schema.md`
  - `.planning/workstreams/official-web-target-inventory/SELECTED-WRITE-HANDOFF.md`
  - `.planning/workstreams/official-web-service-info-target-expansion/FIELD-DENOMINATOR.md`
- Do not widen collection scope to host/seed broad crawl to compensate for missing fields.
- Do not add app-api selected-write mutation as a convenience path.

## Close Rule

Close this workstream only after:

- field denominator is explicit
- `selected_write_requires_review` is backed by machine review summaries, not a manual approval gap
- candidate inventory expansion is source-backed
- no-promotion preview evidence exists for accepted candidates
- ready/blocked/excluded states are machine explainable
- selected-write handoff is ingestion-owned
- released projections are verified through runtime consumption
