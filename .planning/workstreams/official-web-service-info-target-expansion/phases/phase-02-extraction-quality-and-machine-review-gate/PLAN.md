---
doc_type: plan
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Extraction Quality And Machine Review Gate

## Goal

Implement deterministic machine field review as the selected-write readiness gate.

## Tasks

1. Derive review fields from target inventory `required_fields` plus `required_evidence`.
2. Treat missing target inventory as fail-closed.
3. Allow readiness without a human approval manifest when every machine field is present.
4. Preserve explicit rejected / needs-more-evidence manifests as blockers.
5. Report `targetFieldReviews` with field status, required evidence and selected-write readiness.
6. Require `fieldStatus` on selected-write release task admission and execution.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.official_web_handoff_consumer_staging_suite tests.ingestion.test_official_web_release_task_admission tests.ingestion.test_release_official_web_selected_write
```
