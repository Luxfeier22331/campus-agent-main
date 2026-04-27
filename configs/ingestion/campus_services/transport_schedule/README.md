# transport_schedule collection config

This directory holds the repo-tracked config scaffolding for the
`transport_schedule` collection within the `campus_services` corpus.

Current runtime truth:

- serving stage: `offline_preparation`
- retrieval enabled: `false`
- query enabled by default: `false`
- source channel: `authenticated_notice_portal`
- release artifacts:
  `campus_services/releases/transport_schedule/{release_id}/...`
- current projection artifact:
  `campus_services/releases/transport_schedule/current/campus-services-projection.json`

`transport_schedule` owns the normalized projection used by
`transport_schedule_lookup`. It is not a generic retrieval collection and must
not be exposed as a query-serving alias until the release-gate regression and
eval evidence are available.

The production path consumes ready
`campus_services/service_status_candidate` entries from
`notice_consumption_projection` where
`role_metadata.service_status_candidate_kind=transport_schedule`. OCR has
already happened in the authenticated-notice source projection; this collection
only reads derived `document-units.jsonl` / `canonical.md`, cleans table context,
and emits the normalized projection.

It does not rescan raw attachments at query time and does not let Go read object
storage directly. The Docker runtime reads the PostgreSQL
`structured_projection_current` pointer and typed transport read model.

Projection snapshots distinguish baseline schedules from bounded temporary
overlays with `schedule_scope`, `service_date_ranges`, and `precedence`.
Temporary overlays only apply to their explicit service-date ranges; the Go
runtime falls back to the current baseline outside those ranges.
