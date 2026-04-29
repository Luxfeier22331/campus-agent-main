---
doc_type: phase_plan
phase: "7"
phase_name: "Non-Regulation Derived-Unit Coverage"
status: completed
created: 2026-04-24
updated: 2026-04-24
---

# Phase 7 Plan

## Objective

Close the remaining internal_notice non-regulation derived-unit implementation gaps without opening new runtime/query surfaces.

## Scope

- `procurement_notice` notice category and projection unit
- internal restricted `roster_publication` / `lecture_activity` no-adoption truth
- `service_status_override` projection candidate truth, held in notice runtime
- `attachment_form_template` projection truth, held in notice runtime
- targeted tests and classification config for admitted notice categories

## Non-goals

- campus services runtime opening
- document center rollout
- publication/news opening
- supplier lifecycle or procurement stage model

## Completion Notes

- `procurement_notice` is now a notice category and projection role for archive/query use, not a regulation/service target.
- internal restricted roster and lecture notices now emit explicit `no_adoption` units.
- service-status-like notices now emit `service_status_override` units with `target_surface=service_status_runtime` but `consumption_status=held_in_notice_runtime`.
- form/template attachments now emit `attachment_form_template` units that remain in `notice_runtime`.
