---
phase: "6"
name: "Notice Source-family Serving Admission"
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 6 Summary

## What Closed

- Admitted `wechat_public_notice` through the existing
  `campus_notice_discover/get` structured notice tools.
- Kept `internal_notice_restricted` behind restricted authorization while
  admitting public source families by source-family policy.
- Added reference-only `campus_notice_get` semantics for public notice rows that
  have title / URL metadata but no captured canonical body.
- Materialized retained WeChat public notice projection rows into the existing
  source-family-capable notice read model.
- Kept WeChat out of generic RAG, `official_web`, authenticated notice, and
  separate query runtime paths.

## Local Smoke Evidence

- Capture run: `wcrun_5e6910a81e714fcda0e44dfc2b1bda9c`
- Notice id: `woa_article_1335feaf76d3fc90b63b3999`
- Source URL:
  `https://mp.weixin.qq.com/s/I_0ji-iVJWm_ukb6UNDMiw`
- Projection result:
  - `projection_entry_count=1`
  - `retained_count=1`
  - `duplicate_suppressed_count=0`
- Read model result:
  - `read_model_entry_count=1`
  - `read_model_queryable_count=1`
  - `query_serving_opened=true`
- Go runtime result:
  - `campus_notice_discover`: `outcome=resolved_current`
  - `campus_notice_get`: `outcome=resolved_current`,
    `reference_only=true`

## Verification Evidence

- `uv run --all-packages campus-ingestion-project-wechat-public-notices --capture-run-id wcrun_5e6910a81e714fcda0e44dfc2b1bda9c --source-bucket campus-rag-source`
- `go test ./internal/structuredquery -run Notice` (in `apps/supervisor-api`)
- `uv run --all-packages python -m unittest tests.contracts.contract_models_services_and_notice_suite`
- `uv run --all-packages python -m unittest tests/contracts/contract_models_runtime_and_tools_suite.py`
- `uv run --all-packages python -m unittest tests/agent/test_notice_agent.py`
- `uv run --all-packages python -m unittest tests/ingestion/test_project_wechat_public_notices_worker.py tests/ingestion/test_wechat_public_notice_projection.py`
- `uv run --all-packages ruff check` on the changed Python files for contracts,
  notice-agent, ingestion-core, ingestion-worker, and tests
- `pnpm --filter wechat-official-account-collector test`
- `pnpm --filter wechat-official-account-collector typecheck`
- Local `supervisor-api` structured query smoke against
  `/internal/query/notices/discover` and `/internal/query/notices/get`

## Deferred Risks

- FeedWe rate limits, retention guarantees, deletion/update semantics, and SLA
  remain provider-side operational risks.
- WeChat article body capture remains deferred; the admitted serving posture is
  reference-only until a body-capture contract is explicitly admitted.
- The physical table name `internal_notice_read_model` is semantically narrow;
  it is acceptable for this phase because the schema already carries
  `source_family/source_collection`, but a later data-plane cleanup should
  rename or abstract it as a general notice read model.
