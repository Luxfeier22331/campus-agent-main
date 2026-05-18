---
doc_type: gap_ledger
status: active
created: 2026-05-10
updated: 2026-05-10
---

# Gap Ledger: Campus Services Runtime Tool Gap Closeout

This ledger distinguishes completed runtime readiness from residual product
rollout work. It is not a new active implementation plan.

## Closed In This Closeout

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Admitted campus-services structured tools must not be represented as generic retrieval query-serving collections. | closed | `structured_query_serving` is accepted by `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py`; profile validation rejects `retrieval_enabled=true`, `query_enabled_by_default=true`, or `structured_query_enabled=false`; structured profiles keep `retrieval_enabled=false` and `query_enabled_by_default=false`. |
| `service_status_lookup`, `service_guide_lookup`, `contact_directory_lookup`, `transport_schedule_lookup`, and `academic_calendar_lookup` must have explicit structured runtime profile admission. | closed | Runtime profiles under `configs/ingestion/campus_services/*/runtime-profile.json` and `configs/ingestion/calendar/academic_calendar/runtime-profile.json`; drift guard in `tests/supervisor/test_query_serving_scope_policy_drift.py`. |
| `service_catalog` must not be accidentally opened while `service_process_lookup` remains later-wave. | closed | `configs/ingestion/campus_services/service_catalog/runtime-profile.json` remains `offline_preparation`; `tests/ingestion/test_corpus_runtime_profile.py` asserts it is not structured-query enabled. |
| Default query-serving scope must remain unchanged. | closed | `tests/supervisor/test_query_serving_scope_policy_drift.py` still maps default query scopes only from `query_enabled_by_default=true`; structured profiles remain default-off. |
| Product-path opening gate must still open only the admitted first-wave tools. | closed | `uv run --all-packages python -m scripts.eval_gate accept --profile campus-services-product-path --json` produced `.tmp/evals/campus-services-product-path-opening-gate-accept-20260510T154245/`; gate passed 8/8 checks; `service_status_lookup`, `transport_schedule_lookup`, `service_guide_lookup`, and `contact_directory_lookup` are `open`; `service_process_lookup` remains `keep_closed`. |

## Residual Non-Blocking Product Gaps

| Gap | Owner / Trigger | Current Status |
|-----|-----------------|----------------|
| Staging/prod opening evidence for public chat. | `public-chat-campus-services-e2e-acceptance`; reopen when real `/readyz` or live smoke evidence drifts. | Not part of this runtime-profile closeout. |
| Long-tail alias and clarification denominator expansion. | New denominator workstream or explicit product regression. | Non-blocking quality backlog after local product-path gate. |
| `service_process_lookup` runtime implementation and product admission. | New later-wave admission workstream. | `keep_closed`; `service_catalog` remains `offline_preparation`. |
| Multi-agent workflow chaining for baseline schedule + notice override, guide + contact, and guide + navigation references. | Governed workflow runtime when a concrete scenario is admitted. | Not opened by this closeout. |

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_corpus_runtime_profile tests.supervisor.test_query_serving_scope_policy_drift -q
uv run --all-packages python -m unittest tests.ingestion.test_corpus_runtime_profile tests.supervisor.test_query_serving_scope_policy_drift tests.evals.campus_services_product_path_opening_gate_suite tests.evals.campus_services_product_path_eval_gate_profile_suite tests.agent.test_campus_services_agent tests.agent.campus_services_academic_calendar_suite tests.ingestion.test_structured_projection_postgres -q
go test ./internal/structuredquery ./internal/runtimepolicy ./internal/httpapi
uv run --all-packages python -m scripts.eval_gate accept --profile campus-services-product-path --json
pnpm --dir apps/public-chat-web exec vitest run test/worker.test.ts
```

Result on 2026-05-10:

- profile drift lane: pass, 34 tests
- combined Python campus-services lane: pass, 95 tests
- Go structured runtime lane: pass
- product-path opening gate: pass, 8/8 checks
- public-chat worker focused lane: pass, 23 tests
