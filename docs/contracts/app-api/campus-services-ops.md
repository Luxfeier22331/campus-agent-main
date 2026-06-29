---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-11
updated: 2026-06-28
---

# App API Campus Services Ops

## Boundary

This document owns the app-api operator HTTP contract for the current campus
services ops surface. Current scope is limited to shuttle transport
attestations, transport overrides, release preview/publish and audit events.

It does not define:

- generic service status lookup
- service guide, contact directory or process guide APIs
- execution-control `transport_schedule_lookup` payload/result shape
- browser transport status projection JSON
- raw notice, chat, screenshot or object-storage evidence responses

## Admission

All endpoints require an admitted operator principal. Non-operator principals
return the shared app-api error envelope from `error.md` with
`code="forbidden"`.

## Endpoints

- `GET /api/operator/campus-services/candidates`
- `POST /api/operator/campus-services/attestations`
- `GET /api/operator/campus-services/transport-overrides`
- `POST /api/operator/campus-services/transport-overrides`
- `PATCH /api/operator/campus-services/transport-overrides/:overrideId`
- `GET /api/operator/campus-services/releases`
- `POST /api/operator/campus-services/releases/preview`
- `POST /api/operator/campus-services/releases`
- `GET /api/operator/campus-services/audit-events`

## Source Attestation

`POST /api/operator/campus-services/attestations`

Request fields:

- `sourceType`
- `summary`
- `operatorNotes`
- `confirmedAt`

Allowed `sourceType` values:

- `counselor_notice`
- `group_message`
- `phone_confirmation`
- `onsite_confirmation`
- `operator_curated`
- `official_web_candidate`
- `authenticated_notice_candidate`

Rules:

- `summary` is operator-safe and must not contain raw evidence.
- `operatorNotes` is a sanitized review note.
- `confirmedAt` must be an ISO timestamp.

## Transport Override

`POST /api/operator/campus-services/transport-overrides`

Request fields:

- `routeId`
- `displayName`
- `serviceStatus`
- `message`
- `effectiveFrom`
- `effectiveUntil`
- `sourceAttestationIds`

Allowed `serviceStatus` values:

- `normal`
- `delayed`
- `extra_service`
- `rerouted`
- `suspended`
- `temporarily_unavailable`

Rules:

- `effectiveFrom` and `effectiveUntil` are required.
- `effectiveUntil <= effectiveFrom` returns `422 validation_failed`.
- `sourceAttestationIds`, when present, must reference existing attestations.
- created overrides default to `reviewState="ready_for_publish"`.
- `PATCH` supports the same editable subset plus `reviewState`:
  `draft`, `ready_for_publish`, `published`, `archived`.

## Preview And Publish

`POST /api/operator/campus-services/releases/preview`

- computes current-effective transport overrides
- returns preview diff and warnings
- does not create release rows
- does not write publish audit event

`POST /api/operator/campus-services/releases`

- creates a published release snapshot
- writes release and audit event in one store transaction
- must not produce best-effort partial publish

The published release is the app-api ops-store summary consumed later by
execution-control/tool read-model paths. Runtime lookup must not query-time
scan raw sources or attestations.

## Audit

`GET /api/operator/campus-services/audit-events`

Returns operator-safe audit events only. Audit responses must not include raw
chat, screenshots, OCR payload, attachment bytes, bucket/object keys, provider
payloads or sink raw events.
