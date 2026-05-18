---
doc_type: closeout
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Closeout: Official Web Consumer Denominator Recovery

## Result

The official-web recovery path is now consumer-denominator driven.

The repo no longer treats broad public crawl as sufficient reason to retain source-truth for
downstream use. Routine recovery is bounded to pages that match one of the admitted consumer
families:

- `contact_directory_candidate`
- `service_guide_candidate`
- `stable_reference_candidate`
- `notice_news_candidate`

## Implemented Changes

- Added `configs/sources/official_web/muc_public/consumer-denominator.json`.
- Recut scheduler lanes from `university-core-*` news-oriented recovery to
  `consumer-candidate-hot` and `consumer-stable-baseline`.
- Added collector-side consumer candidate evaluation, retained/rejected gating, page manifest
  metadata and run counters.
- Preserved `audit_only` mode only for regression/diagnostic compatibility; repo config uses
  `retain_matching_only`.
- Added consumer-first projection routing:
  - stable-reference matches emit `official_web/stable_reference` release candidates
  - contact/service/news matches stay in `consumer_candidate_pages`
  - notice/news remains inventory-only
- Added projection validation for consumer candidate shape, matched evidence and selected-write
  target requirements.
- Added handoff staging `consumerCandidateReview` and selected-write dry-run gate output.
- Updated official-web architecture, crawl policy and source-truth schema docs.

## No-Promotion Evidence

The implemented staging path keeps promotion closed by default:

- `OfficialWebHandoffConsumerSettings.promote_import` defaults to `False`.
- Handoff consumer stages replay, validation, chunk audit, coverage and candidate review before any
  registry write.
- Candidate-only contact/service pages are reported as
  `selected_write_review_required`; `selectedWrite.decision` is `blocked` until reviewed extraction
  evidence exists.
- Inventory-only notice/news candidates are not eligible for read-model write.
- Stable-reference candidates remain release-gate scoped and do not refresh serving aliases in this
  workstream.

## Verification

Focused verification commands:

```bash
pnpm --dir apps/official-web-collector test
pnpm --dir apps/official-web-collector typecheck
uv run --all-packages python -m unittest \
  tests.ingestion.test_official_web_projection \
  tests.ingestion.test_official_web_handoff_consumer
```

Additional closeout checks:

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/official_web_projection_engine.py \
  packages/ingestion-core/src/campus_ingestion_core/official_web_projection_shared.py \
  packages/ingestion-core/src/campus_ingestion_core/official_web_projection_validation.py \
  apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py \
  apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_reporting.py \
  tests/ingestion/official_web_projection_core_metadata_suite.py \
  tests/ingestion/official_web_handoff_consumer_staging_suite.py \
  tests/ingestion/official_web_handoff_consumer_test_support.py
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/official_web_projection_engine.py \
  packages/ingestion-core/src/campus_ingestion_core/official_web_projection_shared.py \
  packages/ingestion-core/src/campus_ingestion_core/official_web_projection_validation.py \
  apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py \
  apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_reporting.py \
  tests/ingestion/official_web_projection_core_metadata_suite.py \
  tests/ingestion/official_web_handoff_consumer_staging_suite.py \
  tests/ingestion/official_web_handoff_consumer_test_support.py
pnpm exec markdownlint-cli2 --config .markdownlint-cli2.jsonc \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/official-web-consumer-denominator-recovery/**/*.md \
  configs/sources/official_web/muc_public/README.md \
  docs/architecture/domains/official-web/architecture.md \
  docs/data/official-web-source-truth-schema.md \
  docs/policies/official-web-crawl-policy.md
```

## Explicit Non-Openings

This workstream did not:

- run a full historical official-web backfill
- promote registry current truth by default
- refresh retrieval serving aliases
- open `fresh_news` or `news_archive`
- allow protected panel to read object storage or ingestion tables directly
- move service/contact read-model ownership into the collector

## Reopen Rule

Reopen only if:

- consumer-denominator metadata stops being attached to retained source-truth
- scheduler defaults again include broad news recovery
- contact/service/news candidate pages bypass review and write current read models
- stable-reference release candidates bypass release gate or serving alias admission
- `fresh_news` or `news_archive` is opened without a separate runtime/news workstream
- production live seam evidence is required for a deployment promotion after local direct-process
  evidence expires
