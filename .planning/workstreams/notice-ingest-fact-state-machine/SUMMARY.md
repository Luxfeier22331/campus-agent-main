---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Summary: Notice Ingest Fact State Machine

This workstream replaced notice-level media hard gates with source/media/fact/target state projection.

Implemented:

- fact state contract validator
- media role classifier
- target fact readiness builders
- transport replay refactor
- service-status replay refactor
- regulation fact readiness exposure
- evidence replay and guard tests
- notice-first source retention decision model
- source-truth retention summary / attachment policy fields
- collected notice reimport preview `source_retention` output
- metadata-only attachment filtering from required source object refs
- Batch 3 audit for 83 legacy `process/no target` units
- live collector fetch admission from `authenticated_notice_attachment_fetch_request_manifest_v1`
- collector default reference-only attachment capture
- run-ledger required object verification for required/admitted owner bytes
- typed terminal/transient attachment failure propagation from collector into source-truth
  refs
- attachment-ref-scoped state-machine audit for candidate binding, fetch request closure,
  source-capture repair, and stale candidate source-object refs
- `file_release` source-ref preview normalization for historical object-backed refs
  missing provider/status
- media extraction attempt ledger and media closeout / target admission state-machine
  audit
- strict fail-closed media closeout gate for attempt, closeout, target admission, cleanup
  and source-object verification evidence
- collect -> ingest repair loop removing remaining medium/high bypasses in promotion,
  object verification, closeout provenance, target admission and cleanup identity
- live source-object verification, mandatory direct promotion gate, and destructive
  cleanup audit freshness gate

Acceptance:

- `355881`: 7 text-primary transport rows, `ready_from_text`, `stage_ready`.
- `355867`: required media remains `needs_multimodal`.
- `355650`: text-complete service status stages despite supplemental pending media.
- regulation remains owner-text gated.
- notice-level query attachments remain metadata-only unless a downstream target-required fact
  gap or admitted owner explicitly requires bytes.
- collector does not download internal or allowlisted inline image bytes unless an explicit
  fetch admission exists.
- required/admitted owner bytes fail collector run ledger verification when missing; quarantine
  bytes do not count as required source objects.
- retryable attachment failures remain retryable state
  `attachment_capture_state=transient_failed` instead of silently becoming metadata-only.
- media candidates must reference the concrete attachment bytes they consume.
- regenerated collect-to-ingest state-machine audit covers 338 units / 60 candidates and
  reports zero findings.
- current 60 media candidates all have normalized attempt ledger rows; media closeout
  state-machine audit reports zero findings with planned closeout and source-object
  verification evidence.
- current 60 media candidates pass strict full-gate audit with target admission coverage,
  cleanup protection and complete bucket/key/hash/size/storage-provider object verification.
- current strict gate also requires promotion-time media gate evidence, matching completed
  attempt provenance, target/source-consistent admission rows and bucket/key cleanup identity.
- current implementation also requires live source-object verification method/timestamp,
  direct promotion media-gate evidence, target fact-readiness fields, and non-stale audit
  evidence before destructive quarantine cleanup.

No production data writes were performed.
