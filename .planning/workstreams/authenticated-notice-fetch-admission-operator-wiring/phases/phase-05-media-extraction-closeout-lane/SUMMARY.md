---
doc_type: summary
phase: phase-05-media-extraction-closeout-lane
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Summary: Media Extraction Closeout Lane

## Completed

- Added canonical `notice_media_extraction_closeout_result_manifest.v1`.
- Added dry-run closeout merge that updates `notice_media_extraction_candidate_inventory.v1` statuses from closeout result manifests.
- Terminal closeout statuses `completed`, `skipped`, and `failed_terminal` clear `target_blocking`, allowing quarantine cleanup after extraction is terminal.
- Schedule image OCR post-run preview now emits a media extraction closeout result manifest.
- Regulation owner-text execution report now emits a media extraction closeout result manifest.
- Added ingestion-worker CLI for closeout preview output:
  `campus-ingestion-preview-collected-notice-media-extraction-closeout`.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_media_extraction_closeout \
  tests.ingestion.test_collected_notice_schedule_image_ocr_mini_batch \
  tests.ingestion.test_preview_schedule_image_ocr_mini_batch_worker \
  tests.ingestion.test_collected_notice_regulation_owner_text_execution
```

## Remaining

- Live selected collector smoke remains blocked by authenticated portal session refresh.
- Actual provider execution for the broader pending candidate set remains a separate operational run; this phase closes the state transition after execution results exist.
