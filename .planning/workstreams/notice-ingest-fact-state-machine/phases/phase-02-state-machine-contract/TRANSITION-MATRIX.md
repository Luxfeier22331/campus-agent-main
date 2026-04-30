---
doc_type: contract
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Transition Matrix

| Source | Media | Fact | Target |
| --- | --- | --- | --- |
| `searchable_ready` | `not_required` | `ready_from_text` | `stage_ready` |
| `searchable_ready` | `ocr_pending` supplemental | `ready_from_text` | `stage_ready` |
| `searchable_ready` | `ocr_pending` carrier | `blocked_by_required_media` | `needs_multimodal` |
| `searchable_ready` | `ocr_ready` carrier | `ready_from_ocr` | `stage_ready` |
| `searchable_ready` | `manual_review` | `review_required` | `manual_review` |
| `invalid_capture` | any | `missing` | `blocked` |

This matrix is intentionally target-neutral; target-specific policies add baseline/current/search-only behavior after fact readiness is known.
