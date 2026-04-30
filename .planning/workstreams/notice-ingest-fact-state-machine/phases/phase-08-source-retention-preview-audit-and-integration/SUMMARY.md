---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Summary

Implemented:

- Added `authenticated_notice_source_retention_decision.py`.
- Mapped routing output to `notice_capture_route`.
- Added source retention summary fields to `source-truth/notice-manifest.json`.
- Added per-attachment capture / retention fields to `source-truth/attachment-refs.jsonl`.
- Exposed `source_retention` in collected notice reimport preview.
- Filtered metadata-only attachments out of planned required source object refs.
- Added tests covering notice-level query, service-fact, document-owner, capture-only and
  preview integration behavior.

Acceptance:

- `notice_level_query_only` attachments are metadata-only and not required source objects.
- `candidate_service_fact` only fetches attachment bytes when a required fact gap points
  to that attachment.
- `candidate_document_owner` requires bytes only when source truth or admission explicitly
  marks the attachment required.
- `capture_only_no_adoption` keeps attachment refs as metadata-only.
- 83 legacy `process/no target` preview units now resolve to metadata-only attachment
  handling.

No production data writes were performed.
