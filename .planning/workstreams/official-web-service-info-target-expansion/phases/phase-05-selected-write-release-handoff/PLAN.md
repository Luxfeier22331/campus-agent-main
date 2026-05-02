---
doc_type: plan
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: Selected-Write Release Handoff

## Goal

Ensure selected-write handoff is ingestion-owned and only admits machine-ready candidates.

## Tasks

1. Add `fieldStatus`, `requiredFields` and `requiredEvidence` to selected-write release task
   evidence.
2. Reject selected-write release task admission when machine field status is missing or incomplete.
3. Reject selected-write execution when task evidence lacks `fieldStatus` or `requiredFields`.
4. Keep current structured projection mutation inside ingestion-worker selected-write release.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_official_web_release_task_admission tests.ingestion.test_release_official_web_selected_write
```
