---
doc_type: state
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Phase 8 complete
**Last Activity:** 2026-04-30
**Last Activity Description:** Integrated notice-first source retention decision into source-truth and collected notice reimport preview.

## Progress

**Phases Complete:** 8
**Current Plan:** N/A

## Completed Tasks

- [x] Created failure taxonomy and sample corpus.
- [x] Froze source/media/fact/target contract.
- [x] Implemented media role classifier.
- [x] Implemented fact readiness builders.
- [x] Refactored `transport_schedule` replay to admit text-complete rows with supplemental pending media.
- [x] Refactored `service_status` replay to admit text-complete current status with supplemental pending media.
- [x] Added regulation fact readiness exposure while preserving owner-text gate.
- [x] Generated replay evidence and closeout summaries.
- [x] Added guard tests for the old pending-media hard gate failure mode.
- [x] Added source retention decision model for notice-level query, service-fact,
  document-owner and capture-only routes.
- [x] Added retention fields to notice source-truth manifest and attachment refs.
- [x] Exposed `source_retention` in collected notice reimport preview and filtered
  metadata-only attachments out of required source object refs.
- [x] Audited 83 legacy `process/no target` units and confirmed current routing keeps
  them metadata-only.

## Acceptance Evidence

- `evidence/phase-06-evidence-replay-and-acceptance/acceptance-summary.json`
- `evidence/phase-06-evidence-replay-and-acceptance/transport-schedule-acceptance.json`
- `evidence/phase-06-evidence-replay-and-acceptance/service-status-acceptance.json`
- `evidence/phase-06-evidence-replay-and-acceptance/regulation-acceptance.json`
- `evidence/phase-08-retention-preview-audit/preview-process-no-target-audit.json`

## Known Non-Overlap

- No scheduler, auth renewal, collector provider or public serving surface was changed.
- No DB, object-store, release or current truth writes were performed.
- Existing repo-wide docs lint has unrelated tracked MD013 failures outside this workstream.

## Blockers

No workstream blockers remain.

## Resume Notes

Only reopen if target replay regresses to whole-notice media gating, source retention
regresses to attachment-type-first byte retention, new target fact groups are admitted, or
OCR/owner-text output schemas change.
