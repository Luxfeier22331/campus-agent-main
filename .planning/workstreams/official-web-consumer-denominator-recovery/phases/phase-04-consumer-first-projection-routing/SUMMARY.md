---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Summary

Projection replay now consumes consumer matches before title allowlist routing.

- `stable_reference_candidate` emits `official_web/stable_reference` release candidates.
- `contact_directory_candidate`, `service_guide_candidate` and `notice_news_candidate` are emitted
  as `consumer_candidate_pages`, not current read-model documents.
- Projection validation now checks candidate shape, evidence and selected-write target rules.
