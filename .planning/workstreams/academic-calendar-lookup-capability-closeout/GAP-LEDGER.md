---
doc_type: gap_ledger
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Gap Ledger: Academic Calendar Lookup Capability Closeout

## Completion Audit

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Runtime owner remains `campus-services-agent`; no `calendar-agent` restoration | closed | `configs/runtime/agents.v1.json`, `configs/runtime/tools.v1.json`, `tests.contracts.contract_models_services_and_notice_suite`, `apps/supervisor-api/internal/runtimepolicy` tests |
| Contract represents date-week, named-event range, day-status, class-day-pattern and term-window queries | closed | `packages/contracts/src/campus_contracts/models_tools.py`, `apps/supervisor-api/internal/structuredquery/academic_calendar.go`, `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/tool_function_schema.py`, `tests/contracts/contract_models_services_and_notice_suite.py`, `tests/supervisor/tool_function_schema_suite.py` |
| Provider/bridge contract requires deterministic `query_kind` | closed | `AcademicCalendarLookupPayload` rejects empty/unknown `query_kind`; bridge decoder requires `query_kind`; provider function schema marks `query_kind` as non-null enum; snapshot check passes |
| Trusted execution anchor remains server-owned; no client `time_anchor` | closed | `AcademicCalendarLookupPayload` has no `time_anchor`; result-only `queried_time_anchor`; provider schema fixture omits client `time_anchor` |
| Projection supports record families and event interval fields | closed | `packages/ingestion-core/src/campus_ingestion_core/academic_calendar_projection.py`, `packages/ingestion-core/src/campus_ingestion_core/official_web_academic_calendar_projection.py`, `tests/ingestion/test_academic_calendar_projection.py`, `tests/ingestion/official_web_projection_academic_calendar_suite.py` |
| Current accepted source truth resolves `春假` only as a source-backed colloquial alias | closed | `tests/ingestion/test_academic_calendar_projection.py`, `apps/supervisor-api/internal/structuredquery/runtime_academic_calendar_test.go`; `今年春假是什么时候` resolves to official composite arrangement while preserving `event_alias_types["春假"] == "colloquial"` |
| Resolver handles date-week, named-event range, day-status, class-day-pattern and term-window deterministically | closed | `apps/supervisor-api/internal/structuredquery/academic_calendar.go`, `apps/supervisor-api/internal/structuredquery/runtime_academic_calendar_test.go` |
| Resolver fails closed for missing source refs and rejects unsupported query kinds | closed | `TestLookupAcademicCalendarFailsClosedWhenMatchedRecordHasNoSourceRefs`, `TestLookupAcademicCalendarRejectsUnsupportedQueryKind`, `test_academic_calendar_payload_rejects_unknown_query_kind` |
| Python campus-services adapter remains thin and renders event range answers | closed | `packages/campus-services-agent/src/campus_services_agent/http_query_service.py`, `packages/campus-services-agent/src/campus_services_agent/academic_calendar_adapter.py`, `tests/agent/campus_services_academic_calendar_suite.py` |
| Planner separates calendar facts from notice original and service-guide entry questions | closed | `apps/supervisor-api/internal/structuredplanning/planner.go`, `apps/supervisor-api/internal/structuredplanning/planner_test.go` |
| Public/chat denominator covers date-week and named-event positive cases | closed | `packages/evals/fixtures/public_chat_product_path_cases.v1.json`, `packages/evals/fixtures/public_chat_entry_cases.v1.json`, `tests/evals/public_chat_product_path_eval_suite.py`, `tests/evals/public_chat_entry_e2e_suite.py` |
| Documentation and registry agree on final boundary | closed | `docs/architecture/current-architecture.md`, `docs/architecture/domains/campus-services/architecture.md`, `docs/architecture/system/execution-and-agents-architecture.md`, `docs/architecture/system/data-plane-architecture.md`, `.planning/WORKSTREAMS.md` |

## Final Scope Decisions

- `academic_calendar_lookup` is a campus-services structured tool, not a
  standalone agent.
- Runtime reads only `calendar/academic_calendar` projection/read-model truth.
- `春假` is not inferred from Labor Day, teaching-week windows or generic
  course-suspension text. It only resolves through an admitted source-backed
  colloquial alias that maps to the official composite arrangement.
- `2026-05-09` current truth is the notice-derived `normal_rest_day`, with the
  baseline `执行周一课表` retained only as conflict provenance.
- Real browser/staging public-chat observation remains owned by
  `public-chat-campus-services-e2e-acceptance`; this workstream owns the
  deterministic product-path and entry denominator fixtures.

## Remaining Boundaries

- Audience-specific calendar filtering is preserved as `applies_to` data but is
  not yet a separate selection policy.
- Natural-language relative date arithmetic such as `下周一` must be normalized
  into `target_date` / `date_hint` before deterministic lookup.
- Future spring-break-like support must continue to use explicit source-backed
  alias or event admission; generic inference remains out of bounds.

## Reopen Rule

Reopen only if `academic_calendar_lookup` stops returning source-backed
calendar facts, if `春假` no longer resolves only through the admitted
source-backed colloquial alias path, if `2026-05-09` loses the notice-derived
`normal_rest_day` correction, if runtime begins querying raw
official-web/RAG/image assets, or if planner routing again confuses calendar
fact / notice original / service-guide entry questions.
