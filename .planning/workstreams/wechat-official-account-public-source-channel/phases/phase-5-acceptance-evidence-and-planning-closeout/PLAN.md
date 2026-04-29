---
doc_type: phase_plan
phase: "5"
phase_name: "Acceptance Evidence And Planning Closeout"
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 5 Plan

## Objective

Close the workstream with deterministic acceptance evidence:

- prove `wechat_public_notice` projection behavior is replayable and gate-safe
- prove runtime query-serving remains fail-closed
- record provider/compliance residual risks without reopening scope

## Scope

Phase 5 owns:

- acceptance smoke contract for WeChat projection
- deterministic verification command set
- workstream planning closeout updates

Phase 5 does not own:

- opening `campus_notice_discover/get` for `wechat_public_notice`
- article body capture/crawl
- document/chunk/index/release alias runtime opening

## Implementation Slices

### Slice 1: Acceptance Smoke Worker

- add worker CLI:
  - `campus-ingestion-smoke-wechat-public-notice-phase5`
- dry-run projection from selected source-truth refs
- output deterministic JSON summary:
  - article/projection counts
  - retained/suppressed counts
  - dedupe source-family counters
  - `ok/errors` verdict
  - explicit `query_serving_opened=false`

### Slice 2: Projection Invariant Gate

- fail when:
  - `source_family != wechat_public_notice`
  - suppressed row is not `target_surface=unsupported`
  - `body_state` is not `not_captured`
  - required suppressed source family is missing
  - thresholds for article/retained/suppressed counts are unmet

### Slice 3: Runtime Gate Evidence

- keep Go runtime fail-close test as mandatory evidence:
  - `go test ./internal/structuredquery -run Notice`
- ensure Phase 5 closeout text explicitly states:
  - projection admission does not imply query-serving opening

### Slice 4: Planning Closeout

- mark workstream `completed` in:
  - workstream `README/ROADMAP/STATE`
  - `.planning/WORKSTREAMS.md`
- add phase summary with:
  - command-level verification evidence
  - residual provider risks
  - reopen rule

## Verification

- `uv run --all-packages python -m unittest tests.contracts.contract_models_services_and_notice_suite tests.ingestion.test_wechat_public_notice_projection tests.ingestion.test_project_wechat_public_notices_worker tests.ingestion.test_smoke_wechat_public_notice_phase5_worker`
- `go test ./internal/structuredquery -run Notice` (in `apps/supervisor-api`)
- `uv run --all-packages ruff check apps/ingestion-worker/src/campus_ingestion_worker/smoke_wechat_public_notice_phase5.py tests/ingestion/test_smoke_wechat_public_notice_phase5_worker.py`
- `uv run --all-packages ruff format --check apps/ingestion-worker/src/campus_ingestion_worker/smoke_wechat_public_notice_phase5.py tests/ingestion/test_smoke_wechat_public_notice_phase5_worker.py`
- `pnpm --filter wechat-official-account-core test`
- `pnpm --filter wechat-official-account-core typecheck`
- `pnpm --filter wechat-official-account-collector test`
- `pnpm --filter wechat-official-account-collector typecheck`
- `pnpm docs:lint`
- `git diff --check`
