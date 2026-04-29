---
doc_type: plan
status: completed
created: 2026-04-28
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Notice Consumer Compatibility Matrix

## Goal

Bring WeChat, service-status, and regulation into the object-native ingestion
acceptance matrix without taking over their feature-specific workstreams.

## Rationale

These branches are not unrelated downstream work. They are ingestion consumers:

- WeChat public notices enter `notice_consumption_projection` from
  `wechat_official_account` source-truth artifacts.
- service-status consumes admitted internal notice projection rows into a typed
  structured projection and PG read model.
- regulation consumes selected internal notice source/projection truth into
  `regulations/*` offline preparation artifacts.

The shared closeout requirement is that none of them may depend on local export
files as system truth, bypass consumer admission, or write during dry-run.

## Scope

- WeChat:
  - accept source-truth object refs or capture-run artifact refs
  - verify missing article manifest/content/media refs fail closed
  - prove dry-run does not write admission/projection/read model
  - emit an acceptance artifact with selected refs, dry-run evidence, and missing-object fixture
- service-status:
  - keep `notice_consumption_projection` + consumer admission manifest as input
  - prove typed materialization does not scan raw bundle/source-truth inventory
  - preserve preview/stage/promote explicitness
  - emit an acceptance artifact with selected projection ids and no-raw-scan proof
- regulation:
  - move selected-source import away from local bundle handoff where needed
  - keep local bundle support fixture/dev-only
  - keep regulation quality gate and stop point unchanged
  - emit an acceptance artifact showing selected source refs and fixture-only local path support

## Acceptance Artifact Contract

All Phase 6 artifacts must be committed or retained under:

`.planning/workstreams/authenticated-notice-object-native-ingestion-closeout/evidence/phase-06-notice-consumer-compatibility-matrix/`

Required files:

- `wechat-public-notice-acceptance.json`
- `service-status-acceptance.json`
- `regulation-acceptance.json`

Each artifact must include:

- selected source/projection/admission refs
- dry-run no-write evidence
- object/source-truth health result
- remaining local path usage classification, if any
- command and environment summary sufficient to rerun

## Non-Goals

- No FeedWe/mp.weixin provider redesign.
- No new service-status families or runtime opening.
- No regulation target quality threshold changes.
- No public query-serving opening.

## Tests / Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_project_wechat_public_notices_worker \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_publish_internal_notice_regulation_document_site_worker -q
uv run --all-packages ruff check apps/ingestion-worker packages/ingestion-core tests/ingestion
uv run --all-packages ruff format apps/ingestion-worker packages/ingestion-core tests/ingestion --check
```

## Exit Criteria

- WeChat, service-status, and regulation appear in the acceptance report.
- They consume object/source-truth/projection/admission truth only.
- Dry-run no-write is covered for each relevant consumer path.
- Each branch has a retained acceptance artifact path in workstream evidence.
- Any remaining local path support is explicitly fixture/dev-only.
