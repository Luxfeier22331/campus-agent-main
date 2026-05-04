---
workstream: official-web-service-guide-consumption-quality-closeout
created: 2026-05-04
---

# Project State

## Current Position
**Status:** Active
**Current Phase:** Phase 6 completed
**Last Activity:** 2026-05-04
**Last Activity Description:** runtime-side service-guide closeout landed end-to-end: planner focus routing now covers `office_hours` and `eligibility`, focused procedure answers suppress duplicate compatibility sections, service-guide agent observability now exposes focus/service/source-ref safe details, and preview/runtime eval defaults now cover office-hours and eligibility product questions.

## Progress
**Phases Complete:** 5 of 10
**Current Plan:** `ROADMAP.md`

## Current Slice

Current landed slice:

- `packages/contracts` / Go structured query / Python campus-services-agent now carry canonical
  grouped procedure and focused section metadata
- official-web `service_guide_candidate` extraction now emits `procedure_groups` for VPN-like
  multi-mode steps instead of only flat `process_steps`
- selected-write preview/release keeps `procedure_groups` in projection records and rewrites nested
  step/group `source_refs` to public source URLs
- app-api structured answer shaping now prefers `procedure_groups` when present and includes nested
  source refs in trace/source summary collection
- eval/readiness/runtime-preview tests now cover VPN focused client-install procedure branch,
  procedure-group source-ref completeness, planner `guide_focus`, selected-section thresholds and
  forbidden-token drift
- shared fixture `tests/fixtures/service_guide_vpn_grouped_procedure_result.json` now anchors
  Python contract, Go structured query and app-api structured-answer regression tests
- runtime intent policy now classifies `VPN客户端怎么安装` as `campus_services/service_guide_lookup`
- docs now state `procedure_groups` is canonical procedure truth and `guide_sections.procedure` is
  compatibility summary only
- `packages/ingestion-core/src/campus_ingestion_core/structured_projection_postgres.py` now
  persists the runtime-consumed `service_guide_read_model` fields explicitly:
  `guide_sections`, `procedure_groups`, `materials`, `entry_refs`, `office_hours`,
  `contact_refs`, `eligibility_notes`, `field_status`
- `tests/ingestion/test_structured_projection_postgres.py` now proves the typed PG insert path
  includes grouped procedure / field-status columns for `service_guide_read_model`
- `tests/ingestion/test_release_official_web_selected_write.py` now proves selected-write release
  publishes grouped VPN procedure data and field status into the PG publisher bundle
- `apps/supervisor-api/internal/structuredquery/runtime_service_guide_test.go` now proves focused
  grouped VPN procedure answers still resolve through the PG read-model path using the current
  release pointer
- Phase 3 mixed-version compatibility is now explicit and tested:
  flat legacy records without `procedure_groups` / `field_status` remain publishable, and Go
  runtime still answers them through `guide_sections.procedure` while grouped records use the
  canonical `procedure_groups` path
- `packages/ingestion-core/src/campus_ingestion_core/official_web_projection_engine.py` now
  fail-closes non-VPN composition groups when their primary role is missing or ambiguous:
  `information_disclosure` requires exactly one `procedure_source`, and `email_service` requires
  exactly one `policy_source`
- the same composition helper now enforces group-specific allowed roles; any
  `service_guide_candidate` page in `information_disclosure` / `email_service` with missing or
  unknown `composition_role` is suppressed instead of falling back to single-page candidate
  extraction
- `tests/ingestion/official_web_projection_core_replay_suite.py` now proves:
  - ambiguous duplicate `procedure_source` pages suppress `service_guide_candidate`
  - missing `policy_source` in `email_service` suppresses `service_guide_candidate`
  - ambiguous duplicate `policy_source` pages suppress `service_guide_candidate`
  - unknown `faq_source` service page in `information_disclosure` suppresses
    `service_guide_candidate`
  - valid information-disclosure and email-service compositions still pass
- `apps/supervisor-api/internal/structuredplanning/planner.go` now preserves current
  `contact_directory_lookup` routing for entity-contact questions while explicitly promoting
  `service_guide_lookup` for focused `entry` / `required_materials` / `office_hours` /
  `eligibility` service-guide asks before broad `service_status` keyword hits
- `apps/supervisor-api/internal/structuredplanning/planner_test.go` now pins focused planner cases
  for:
  - `校园卡补办办公时间是什么`
  - `校园卡补办哪些人能办`
- `packages/campus-services-agent/src/campus_services_agent/tool_adapter.py` now suppresses
  duplicate procedure rendering when a focused result contains both canonical `procedure_groups`
  and compatibility `guide_sections` for the same selected section id
- the same adapter now emits service-guide-specific safe observability details:
  - `guide_focus`
  - `resolved_service_id`
  - `resolved_service_display_name`
  - `source_refs_used`
  - `result_guardrail.focus_guardrail`
- `tests/agent/test_campus_services_agent.py` now proves:
  - grouped-procedure answers do not double-render compatibility sections
  - service-guide observability includes focus/service/source-ref safe fields
- `packages/evals/src/campus_evals/official_web_selected_write_preview_runtime_verifier.py` now
  includes default product cases for:
  - `service-guide-campus-card-office-hours`
  - `service-guide-campus-card-eligibility`
- `tests/evals/official_web_selected_write_preview_runtime_verifier_suite.py` now pins those
  default focus classes
- `apps/app-api/test/chat-command.service.core.structured.suite.ts` now proves browser-facing
  structured answers keep a single focused VPN install answer even when both canonical
  `procedure_groups` and compatibility `guide_sections` are present

Next work should continue with:

- remaining Phase 2 extraction/composition cleanup for more non-VPN targets if inventory widens
- Phase 7 real source-pack no-promotion replay proof
- Phase 8 isolated selected-write publish proof
- Phase 9 closeout docs/evidence/state

## Known Worktree Context

At creation time, the workspace already had uncommitted implementation changes for the previous
official-web service-guide extraction/release slice plus unrelated eval dirty files from another
session. This workstream planning update should not be treated as ownership of those unrelated eval
changes.

Relevant dirty files observed at creation time:

- `apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py`
- `packages/ingestion-core/src/campus_ingestion_core/official_web_projection_engine.py`
- `tests/ingestion/official_web_projection_core_replay_suite.py`
- `tests/ingestion/test_release_official_web_selected_write.py`
- unrelated eval/app-api dirty files from another session

## Session Continuity
**Stopped At:** Phase 4-6 runtime closeout is green; remaining work is replay/publish/closeout proof
**Resume File:** `ROADMAP.md`

## Verification

Latest implementation verification run:

```bash
uv run --all-packages python -m unittest tests.agent.test_campus_services_agent tests.evals.official_web_selected_write_preview_runtime_verifier_suite -q
cd apps/supervisor-api && go test ./internal/structuredplanning ./internal/structuredquery
pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.core.structured.test.ts
```
