---
doc_type: taxonomy
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Failure Taxonomy

## Failure Classes

- `notice_level_media_gate`: target replay blocks the whole notice because one media item is pending.
- `carrier_vs_supplemental_confusion`: image/PDF role is not classified before admission.
- `text_facts_ignored`: body/owner text can satisfy required facts but replay waits for OCR.
- `required_media_not_scoped`: pending OCR is not tied to the specific fact group it carries.
- `weak_target_promotion`: ordinary notice media or weak keywords promote to a typed target.

## Primary Regression

`355881` is `text_facts_ignored` plus `carrier_vs_supplemental_confusion`.

- Body has complete transport facts.
- Image is location evidence.
- Correct state: `ready_from_text` + `supplemental_media_pending` + `stage_ready`.

## Required Counterexample

`355867` is a required-media case.

- Body announces schedule arrangements but does not contain rows.
- Images carry the schedule table.
- Correct state: `blocked_by_required_media` + `needs_multimodal`.

## Target-Specific Rules

- `transport_schedule`: body rows satisfy route/window/departure facts.
- `service_status`: body status/window facts can stage even if supplemental images remain pending.
- `regulation`: owner document text remains required; weak notice-surface media cannot promote.
- `searchable_notice`: all valid notices remain searchable regardless of downstream admission.
