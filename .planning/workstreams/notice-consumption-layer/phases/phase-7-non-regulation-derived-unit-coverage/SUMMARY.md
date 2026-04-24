---
doc_type: phase_summary
phase: "7"
phase_name: "Non-Regulation Derived-Unit Coverage"
status: completed
created: 2026-04-24
updated: 2026-04-24
---

# Phase 7 Summary

## Outcome

Phase 7 filled the non-regulation projection coverage that was still only planning truth:

- added shared role/value constants for `procurement_notice`, `roster_publication`, `lecture_activity`, `service_status_override`, and `attachment_form_template`
- added `service_status_runtime` as a target-surface hint while keeping service-status units held in notice runtime
- added procurement notice category config and service-status notice family config
- added projection builder coverage for procurement archive units, internal restricted no-adoption units, service-status candidates, and attachment form/template units
- kept all new non-regulation units out of `regulations/*` materialization and out of query-serving/runtime opening

## Verification Focus

- projection unit construction for procurement, roster, lecture, service-status, and form-template cases
- procurement regulation titles remain `policy_regulation`
- service status notices classify to `hold_notice_runtime`
- downstream regulation/scoped materialization continues to use projection ready gates
