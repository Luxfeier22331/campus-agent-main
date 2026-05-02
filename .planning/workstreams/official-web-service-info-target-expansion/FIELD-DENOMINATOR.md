---
doc_type: contract
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Field Denominator And Machine Review Contract

This document freezes the service-info denominator for
`official-web-service-info-target-expansion`.

It resolves the distinction between:

- family-level admission evidence in `target-source-map.json` and
  `consumer-denominator.json`
- target-level `required_fields` in `target-inventory.json`
- machine review summaries reported by ingestion-worker to app-api

## Contract Inputs

- `configs/sources/official_web/muc_public/consumer-denominator.json`
- `configs/sources/official_web/muc_public/target-source-map.json`
- `configs/sources/official_web/muc_public/target-inventory.json`
- `.planning/workstreams/official-web-target-inventory/SELECTED-WRITE-HANDOFF.md`

## Contact Directory Denominator

The current family-level selected-write denominator is source-backed contact evidence, with
`phone` as the required evidence field:

- required: `phone`
- optional when the source provides it: `email`, `location`, `office_hours`

The structured projection must also preserve:

- organization or department name
- source URL
- source observation/version identity
- responsibility or service scope when source text provides it

Selected-write readiness requires:

- all target inventory `required_fields` are marked `present`
- all configured `required_evidence` is marked `present`
- source object keys, raw asset id and raw version id are present

If a public page lacks `email`, `location` or `office_hours`, the candidate may still be released
when required phone evidence and source lineage are present. The missing optional fields must be
preserved as source-not-provided gaps instead of being fabricated or filled from unrelated pages.

## Service Guide Denominator

The current family-level selected-write denominator requires a source-backed process description:

- required: `service_process`
- optional when the source provides it: `service_entry`, `service_material`, `phone`, `location`,
  `office_hours`

The structured projection must also preserve:

- service name
- responsible unit
- service scope or audience when source text provides it
- source URL
- source observation/version identity

Selected-write readiness requires:

- all target inventory `required_fields` are marked `present`
- all configured `required_evidence` is marked `present`
- source object keys, raw asset id and raw version id are present

If a public page describes a service but omits materials, office hours or contact method, the
candidate may still be released only when its configured required fields and process evidence pass.
Missing optional fields must remain explicit gaps in the release evidence and projection.

## Machine Review Semantics

`selected_write_requires_review` does not mean a required human approval step for this workstream.

For contact directory and service guide targets, review is machine-generated field review:

- ingestion-worker derives `field_status` from target inventory `required_fields`
- ingestion-worker checks required evidence from the denominator configs and treats optional
  evidence as source-preserved enrichment
- ingestion-worker reports `targetFieldReviews` to app-api through the existing internal callback
- app-api stores the sanitized summary in
  `official_web.target_artifact_verification_summaries`
- target inventory projection classifies each row as `ready_for_selected_write`, `blocked_fields`,
  `inventory_only` or `excluded`

Human intervention is limited to source/config remediation outside the normal release path. It is
not modeled as an approval queue for candidates that fail deterministic checks.

## Fail-Closed Rules

- Missing source lineage blocks selected-write.
- Missing target inventory `required_fields` blocks selected-write.
- Missing configured required evidence blocks selected-write.
- Missing optional evidence must be recorded as source-not-provided and must not block release by
  itself.
- Ambiguous ownership blocks selected-write.
- Duplicate facts from conflicting pages block selected-write until a deterministic source priority
  is documented.
- Parser failure blocks selected-write; it does not create a manual approval state.
