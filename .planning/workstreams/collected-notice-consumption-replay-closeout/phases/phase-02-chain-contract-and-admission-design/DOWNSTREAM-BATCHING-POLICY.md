---
doc_type: policy
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Downstream Batching Policy

## Allowed Targets

Phase 6 may replay only these targets:

- `regulation`
- `transport_schedule`
- `service_status`

`service_guide` is explicitly excluded from Phase 6 unless later re-admitted.

## Shared Rules

- Every target batch must consume `collected_notice_consumer_admission.v1`.
- Every target batch must have dry-run before write.
- Every target batch must report accepted, rejected, deferred, and blocked entries.
- Every target row must reference searchable unit id and source object refs.
- Current promotion is never implicit; stage/replay and current promotion are separate actions.

## Regulation

Admit when:

- notice or attachment contains institutional rule, scoped rule, official policy, or long-lived regulation semantics.
- source has enough authority/provenance for document holding or regulation candidate materialization.

Block when:

- notice is only an event announcement, roster publication, temporary reminder, or incomplete wrapper text.
- authoritative attachment is missing.

Default stop point:

- gated materialization / candidate holding.
- no query-serving opening by default.

## Transport Schedule

Admit when:

- notice contains bus, shuttle, route, departure, service exception, or transport operation facts.
- schedule facts are text-extractable or OCR/multimodal evidence exists.

Block when:

- schedule facts are only in image/PDF and Phase 5 has not produced normalized evidence.
- notice is only a generic travel reminder without operational schedule.

Default stop point:

- stage release with consistency report.
- current promotion only through explicit promotion command.

## Service Status

Admit when:

- notice expresses service availability, suspension, relocation, temporary change, platform outage, opening/closing, or access change.
- subject, campus/location/platform scope, effective time, and status reason are extractable.

Block when:

- notice is general service guide, stable contact info, promotion/news, or event information.
- status subject cannot be normalized.

Default stop point:

- read-model stage or release candidate.
- current promotion only through explicit promotion command.

## Rejected And Deferred Sources

Every rejected or deferred entry must include:

- source notice id.
- candidate target.
- reason codes.
- whether searchable still exists.
- whether multimodal processing could change the decision.

