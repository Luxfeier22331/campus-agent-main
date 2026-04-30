---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
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

Acceptance:

- `355881`: 7 text-primary transport rows, `ready_from_text`, `stage_ready`.
- `355867`: required media remains `needs_multimodal`.
- `355650`: text-complete service status stages despite supplemental pending media.
- regulation remains owner-text gated.
- notice-level query attachments remain metadata-only unless a downstream target-required fact
  gap or admitted owner explicitly requires bytes.

No production data writes were performed.
