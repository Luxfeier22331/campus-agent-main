---
doc_type: contract
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Reason Codes

Core reason codes:

- `body_facts_complete`
- `owner_text_facts_complete`
- `required_fact_missing`
- `required_media_pending`
- `supplemental_media_pending`
- `manual_review_required`
- `baseline_source_covered`
- `historical_search_only`

Legacy drift avoided:

- `multimodal_not_ready` is no longer the generic target blocker.
- target replay uses `required_media_pending` only when media carries missing target facts.
