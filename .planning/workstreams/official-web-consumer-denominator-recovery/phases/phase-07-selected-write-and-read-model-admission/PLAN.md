---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Selected Write And Read-Model Admission

## Goal

Write only reviewed official-web candidates into downstream read-model or release candidate surfaces.

## Tasks

1. Define selected-write input format for reviewed official-web candidates.
2. Add selected-write dry-run for contact-directory candidates.
3. Add selected-write dry-run for service-guide candidates.
4. Add stable-reference release-candidate dry-run for stable pages.
5. Keep notice/news candidates inventory-only.
6. Add safety checks that selected write requires source refs, extraction status and review verdict.
7. Execute selected write only for accepted records if the operator admits it.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_contact_directory_projection \
  tests.ingestion.test_service_guide_projection_validation \
  tests.ingestion.test_official_web_projection_validation
```

## Acceptance

- Ready structured records have source refs.
- Incomplete records go to manual review, not ready read model.
- Selected write is idempotent.
- Notice/news remains unopened.
