---
doc_type: phase_plan
workstream: notice-agent-card-first-tool-boundary
phase: 01-contract-and-toolspec-recut
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1: Contract And ToolSpec Recut

## Goal

Make shared contracts and ToolSpec encode the new card-first notice boundary so Go, Python, provider function calling and SDK adapters cannot drift.

## Depends On

- Phase 0 `BOUNDARY-INVENTORY.md`.
- Final Phase 0 `campus_notice_get` migration decision.

## Contract Design

Introduce or recut these shared shapes in `packages/contracts`:

- `NoticeDisplayPolicy`
  - `public_surface`: `card_only` / `link_only` / `bounded_summary` / `fact_extraction_only`.
  - `full_body_forbidden`: always true for public answer and operator-safe trace.
  - `body_access`: `none` / `internal_context_only` / `downstream_materialization_only`.
- `NoticeCardSet`
  - `query_text`, `outcome`, `notice_cards`, `queried_time_anchor`, downgrade/fail-close fields.
  - User-facing discovery denominator.
- `ResolvedNoticeRef`
  - `notice_id`, `title`, `source_family`, `source_url`, `canonical_url`, `published_at`, `target_surface`, `display_policy`.
  - Selected notice identity and source-card projection.
- `NoticeContextProjection`
  - `projection_id`, `notice_ref`, `content_hash`, `body_excerpt`, `bounded_summary`, `extracted_facts`, `attachment_refs`, `provenance_refs`.
  - No raw `normalized_body`, OCR owner text, inline image text or attachment body.

`CampusNoticeGetResult` must stop requiring `normalized_body` for resolved non-reference results. If the type remains, it must become an internal compatibility shape with `display_policy` and no public-body default. Preferred end state is a renamed selected-ref/context contract rather than a body-get contract.

## ToolSpec Design

Update `configs/runtime/tools.v1.json` and registry validation:

- `campus_notice_discover`
  - remains active,
  - remains `structured_handoff`,
  - may keep `function_schema.available=true` if provider-loop experiments need discovery,
  - returns card set only.
- `campus_notice_get`
  - removed from provider/SDK top-level function schema, or marked inactive/closed if kept only during a hardcut,
  - no longer `provider_loop_pilot`,
  - no longer described as “fetch a notice body”.
- Internal selected notice functions
  - are not automatically top-level tools,
  - may be represented in contract docs or a separate internal query registry,
  - must not be included by `generate_provider_function_schemas()`.

If registry schema needs a new distinction, add one explicitly rather than overloading `surface`:

- `tool_kind`: `agent_facing_tool` / `internal_query_function`, or
- a separate internal query registry outside provider ToolSpec.

## Work Packages

1. Update `packages/contracts/src/campus_contracts/models_tools.py`.
2. Update shared literal enums in `models_shared.py` only if tool names or payload kinds change.
3. Regenerate or update generated schemas/fixtures if this repo tracks them.
4. Update `configs/runtime/tools.v1.json`.
5. Update Go `runtimepolicy` registry validation if new ToolSpec fields or postures are added.
6. Update Python ToolSpec registry/schema generation tests.
7. Update docs contract `docs/contracts/campus-notice-runtime-contract.md` to reflect the new contract truth.

## Expected Test Updates

- `tests/contracts/contract_models_services_and_notice_suite.py`
- `tests/supervisor/tool_spec_registry_suite.py`
- `tests/supervisor/tool_function_schema_suite.py`
- `tests/supervisor/agent_dispatch_suite.py`
- `apps/supervisor-api/internal/runtimepolicy/tool_registry_test.go`
- Provider/SDK fixture snapshots under `packages/evals/fixtures/`

## Verification

```bash
pnpm docs:lint
(cd apps/supervisor-api && go test ./internal/runtimepolicy ./internal/structuredplanning)
uv run --all-packages python -m unittest \
  tests.contracts.test_models \
  tests.supervisor.test_tool_spec_registry \
  tests.supervisor.test_tool_function_schema \
  tests.supervisor.test_agent_dispatch
git diff --check
```

## Exit Criteria

- Shared contracts can express source-card and bounded-context behavior without requiring full body.
- Provider/SDK schema generation cannot expose body/context functions as top-level notice tools.
- Go and Python registry tests agree on allowed notice tools.
