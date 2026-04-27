---
phase: "5"
name: "Acceptance Evidence And Planning Closeout"
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 5 Summary

## What Closed

- Added a repo-owned acceptance smoke command:
  - `campus-ingestion-smoke-wechat-public-notice-phase5`
- The smoke command performs deterministic dry-run verification on selected
  WeChat source-truth refs and outputs `ok/errors` evidence with:
  - retained/suppressed counts
  - dedupe source-family distribution
  - body-state invariant check (`not_captured`)
  - explicit `query_serving_opened=false`
- Existing projection and contract runtime line remains unchanged:
  - `wechat_public_notice` is admitted for projection/read-model evidence
  - Go notice runtime continues fail-close for user-facing query-serving
- Planning truth is closed:
  - roadmap marks `Phase 5` complete
  - workstream state is `completed`
  - `.planning/WORKSTREAMS.md` moved this workstream from Active to Completed

## Verification Evidence

- `uv run --all-packages python -m unittest tests.contracts.contract_models_services_and_notice_suite tests.ingestion.test_wechat_public_notice_projection tests.ingestion.test_project_wechat_public_notices_worker tests.ingestion.test_smoke_wechat_public_notice_phase5_worker`
- `go test ./internal/structuredquery -run Notice` (in `apps/supervisor-api`)
- `pnpm --filter wechat-official-account-collector capture -- --account "中央民族大学学生会" --max-pages 1 --max-articles 5 --size 5`
- `uv run --all-packages campus-ingestion-smoke-wechat-public-notice-phase5 --source-bucket campus-rag-source --article-manifest-key "wechat_official_account/中央民族大学学生会/2026/woa_ver_cc2fb0226a522ccc90e78e30/source-truth/article-manifest.json" --summary-output-path ".planning/workstreams/wechat-official-account-public-source-channel/phases/phase-5-acceptance-evidence-and-planning-closeout/phase5-live-smoke-2026-04-27.json"`
- `uv run --all-packages ruff check apps/ingestion-worker/src/campus_ingestion_worker/smoke_wechat_public_notice_phase5.py tests/ingestion/test_smoke_wechat_public_notice_phase5_worker.py`
- `uv run --all-packages ruff format --check apps/ingestion-worker/src/campus_ingestion_worker/smoke_wechat_public_notice_phase5.py tests/ingestion/test_smoke_wechat_public_notice_phase5_worker.py`
- `pnpm --filter wechat-official-account-core test`
- `pnpm --filter wechat-official-account-core typecheck`
- `pnpm --filter wechat-official-account-collector test`
- `pnpm --filter wechat-official-account-collector typecheck`
- `pnpm docs:lint`
- `git diff --check`

## Deferred Risks

- Live evidence is now captured for this phase (FeedWe capture + phase5 smoke),
  but this sample run used a single account with bounded page/article limits;
  production scheduling still needs separate volume and stability validation.
- FeedWe rate-limit/SLA/retention/update semantics are still provider-side
  operational risks and remain outside this workstream’s implementation scope.
- `wechat_public_notice` runtime opening remains intentionally deferred; any
  future opening requires a dedicated runtime-admission phase.
