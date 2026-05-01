---
doc_type: state
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Official Web Consumer Denominator Recovery

## Current Status

- status: `completed`
- current phase: `Phase 8 closeout complete`
- owner: Codex session
- active implementation: no
- latest completed phase: Phase 8 `Closeout And Handoff`
- next phase: none

## Current Repo Facts

- `official_web` is a unified source channel owned by collector + app-api control plane +
  ingestion-worker handoff.
- Existing official-web restart evidence is artifact-only local replay and does not prove selected
  downstream consumption.
- Current runtime query-serving scopes include `official_web/stable_reference`, but not
  `fresh_news` or `news_archive`.
- Active structured tools include `service_guide_lookup` and `contact_directory_lookup`.
- Current `projection-routing.json` contains only narrow title allowlists for
  `stable_reference` and `fresh_news`.
- Current scheduler policy uses consumer-candidate lanes and no longer includes broad
  `news.muc.edu.cn` recovery in the default hot/baseline lanes.
- Existing campus-card official-web service guide is curated from official web pages, proving that
  service-guide consumption can use official-web provenance when selected and reviewed.

## Key Decision

Official-web collection recovery should not continue as broad page recovery. It should first recover
pages that satisfy one of the admitted downstream denominators:

- contact directory candidate
- service guide candidate
- stable reference candidate
- notice/news inventory-only candidate

## Implemented Surface

- `configs/sources/official_web/muc_public/consumer-denominator.json`
  freezes admitted consumer families, owner surfaces, materialization policies and evidence
  requirements.
- Collector recovery uses `retain_matching_only` in repo config and `audit_only` only for
  regression/local compatibility fixtures.
- Retained page manifests and source-truth bundles carry consumer match metadata.
- Projection replay prioritizes consumer matches before title allowlist routing.
- Contact/service/news matches become `consumer_candidate_pages`; stable-reference matches emit
  `official_web/stable_reference` release candidates.
- Projection validation checks consumer candidate shape, matched evidence and selected-write target
  requirements.
- Handoff staging emits `consumerCandidateReview` with selected-write dry-run gate decisions.

## Blockers

- No implementation blocker.
- Production selected write remains gated by reviewed extraction evidence.
- `fresh_news` and `news_archive` remain closed unless a separate workstream admits them.

## Verification Evidence

Focused commands:

```bash
pnpm --dir apps/official-web-collector test
pnpm --dir apps/official-web-collector typecheck
uv run --all-packages python -m unittest \
  tests.ingestion.test_official_web_projection \
  tests.ingestion.test_official_web_handoff_consumer
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
```

Markdown lint:

```bash
pnpm exec markdownlint-cli2 --config .markdownlint-cli2.jsonc \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/official-web-consumer-denominator-recovery/**/*.md \
  configs/sources/official_web/muc_public/README.md \
  docs/architecture/domains/official-web/architecture.md \
  docs/data/official-web-source-truth-schema.md \
  docs/policies/official-web-crawl-policy.md
```

## Session Continuity

**Stopped At:** implementation complete; closeout docs written.

**Resume File:** `CLOSEOUT.md`
