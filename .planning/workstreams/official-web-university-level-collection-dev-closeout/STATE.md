---
doc_type: state
status: completed
created: 2026-04-28
updated: 2026-04-28
---

# State: Official Web University-Level Collection Dev Closeout

## Current Status

- status: `completed`
- current phase: `closed`
- owner: unassigned
- active implementation: Phase 0-7 已完成
- latest slice: fresh baseline、repeated-run compare、chunk audit 与 import/promote handoff dry-run 已收口

## Current Baseline

- Upstream workstream `official-web-collection-restart-closeout` has fresh
  `university-core` evidence from 2026-04-27.
- Latest accepted fixed projection path:
  `.tmp/official-web-university-level-collection-dev-closeout/runs/20260428T004900Z-university-core-baseline/projection-output`
- Latest accepted university-core projection validation:
  `123` documents, `0` errors, `0` warnings.
- Latest accepted university-core chunk audit:
  `passed = true`, `issue_counts = {}`, `total_units = 702`, `total_chunks = 765`.
- Current registry import/promote state for this workstream: not executed.
- Current serving surface change for this workstream: none.

## Newly Landed Runtime Surface

- new runner module:
  `apps/ingestion-worker/src/campus_ingestion_worker/official_web_university_collection.py`
- new CLI entry:
  `campus-ingestion-run-official-web-university-collection`
- retention dry-run support:
  `apps/ingestion-worker/src/campus_ingestion_worker/report_retention.py`
- official-web import dry-run support:
  `apps/ingestion-worker/src/campus_ingestion_worker/official_web_projection_import.py`
- lane preflight now includes declaration coverage check for all official-web page families.
- `muc_public` projection declarations now cover
  `sitemap_navigation_page/data_table_page/gallery_page/contact_widget_page` as
  `manual_review` declarations.

## Active Lanes

- `university-core-hot`
  - hosts: `www.muc.edu.cn`, `news.muc.edu.cn`, `xxgk.muc.edu.cn`
  - current scheduler policy: enabled
  - intended local role: small high-frequency dev lane
- `university-core-baseline`
  - hosts: `www.muc.edu.cn`, `news.muc.edu.cn`, `xxgk.muc.edu.cn`, `lib.muc.edu.cn`,
    `xiaoyou.muc.edu.cn`
  - current scheduler policy: enabled
  - intended local role: main baseline evidence lane before college rollout

## Latest Execution Evidence (2026-04-28)

- preflight passed:
  `.tmp/official-web-university-level-collection-dev-closeout/reports/preflight-20260428T004900Z-university-core-baseline.json`
- fresh baseline run:
  `.tmp/official-web-university-level-collection-dev-closeout/reports/run-20260428T004200Z-university-core-baseline.json`
  - status: `succeeded`
  - crawl: `127` pages, `0` failures
  - validate: `bundlePages=127`, `errors=0`, `warnings=1`
  - qc: `failPages=0`, `unexpectedReviewPages=0`
  - projection replay: `pages_seen=127`, `emitted_documents=123`, `manual_review_pages=4`
  - projection validate: `documents=123`, `errors=0`, `warnings=0`
  - chunk audit: `passed=true`, `issue_counts={}`
- repeated baseline run:
  `.tmp/official-web-university-level-collection-dev-closeout/reports/run-20260428T004900Z-university-core-baseline.json`
  - status: `succeeded`
  - crawl: `127` pages, `0` failures
  - validate: `bundlePages=127`, `errors=0`, `warnings=1`
  - qc: `failPages=0`, `unexpectedReviewPages=0`
  - projection replay: `pages_seen=127`, `emitted_documents=123`, `manual_review_pages=4`
  - projection validate: `documents=123`, `errors=0`, `warnings=0`
  - chunk audit: `passed=true`, `issue_counts={}`
- repeated-run comparison report:
  `.tmp/official-web-university-level-collection-dev-closeout/compare-20260428T004900Z-vs-004200Z.json`
  - `previous_documents=123`, `current_documents=123`
  - `missing_url_count=0`, `new_url_count=0`, `duplicate_canonical_url_count=0`
  - `drop_ratio=1.0`, `drop_alert=false`
- retention dry-run report:
  `.tmp/official-web-university-level-collection-dev-closeout/retention-dry-run-20260428.json`
- alert summary report:
  `.tmp/official-web-university-level-collection-dev-closeout/alert-summary-20260428.json`
- import dry-run with `--require-promotable` succeeded; no promote, no registry mutation:
  `.tmp/official-web-university-level-collection-dev-closeout/import-dry-run-20260428T004900Z/import-reports/official-web-import-dry-run-2026-04-28T005544.647913_plus_0000.json`
  - `success_count=74`, `skipped_count=36`, `failed_count=0`

## Repair Evidence

- previous failing baseline:
  `.tmp/official-web-university-level-collection-dev-closeout/reports/run-20260428T003000Z-university-core-baseline.json`
  - failed at chunk audit with `stacked_short_label_lines=2`,
    `ellipsis_truncation=4`, `article_section_over_aggregation=1`
- replayed fixed projection from the same crawl artifact:
  `.tmp/official-web-university-level-collection-dev-closeout/runs/20260428T003000Z-university-core-baseline/projection-output-fixed`
  - projection validate: `documents=123`, `errors=0`, `warnings=0`
  - chunk audit: `passed=true`, `issue_counts={}`
  - require-promotable dry-run: `success_count=74`, `skipped_count=36`, `failed_count=0`

## Blockers / Risks

- Do not promote artifact-only projection as registry truth.
- Do not enable college recurring crawl as part of this workstream.
- Do not open `fresh_news` / `news_archive` query-serving as a side effect.
- Output directories must be run-id isolated to avoid confusing old evidence
  with fresh evidence.
- No active blocker remains in this workstream.

## Continuity Notes

- This workstream is closed locally.
- No registry current truth was promoted.
- College rollout remains a separate workstream.
- `fresh_news` / `news_archive` serving surface remains closed.
