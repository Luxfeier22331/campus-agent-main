---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Summary: Reset Derived State To Collected-Only

## Completed Deliverables

- `reset-derived-state.dry-run.json`: deterministic dry-run report for captured-only reset.
- `reset-derived-state.backup.json`: row-level backup artifact for every non-empty reset group and current pointer backup. This artifact was generated locally and intentionally remains uncommitted because it contains full row-level backup data.
- `reset-derived-state.execute.json`: execute report proving dry-run counts and write counts aligned.
- `post-reset-collected-only-audit.json`: post-reset audit with `verdict=passed`.

## Executed Reset

- Deleted `4197` DB rows from source-truth / file-release inventory / registry import rows / projection / admission / OCR attempt / typed downstream reset scopes.
- Updated `1` current pointer: `service_guide` now points to stable release `service-guide-campus-card-20260427T110000`.
- Deleted `0` source bucket objects.
- Preserved collector run ledger with `76` rows.

## Post-Reset State

- source-truth / holding / registry import reset scopes are empty.
- notice projection, read-model, admission, OCR/multimodal attempt reset scopes are empty.
- notice-derived `service_status` and `transport_schedule` releases/read models/current pointers were cleared.
- non-stable `service_guide` rows were cleared; stable campus-card release remains current.

## Next Phase Entry Conditions

Phase 4 can now dry-run reimport from captured source objects and collector run ledger.

Phase 4 must not assume source-truth / holding rows still exist; they were intentionally cleared by this phase.
