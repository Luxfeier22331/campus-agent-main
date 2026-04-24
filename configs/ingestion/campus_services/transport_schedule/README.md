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

The first production path consumes authenticated notice source truth only. It
does not perform OCR, does not rescan raw attachments at query time, and does
not let Go read object storage directly. The Docker runtime consumes a mounted
readonly copy of the current projection through
`SUPERVISOR_STRUCTURED_QUERY_PROJECTION_PATH`.
