---
doc_type: planning_review
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Planning Review: Academic Calendar Source Truth Reconciliation

## Review Result

The workstream is complete. Phase 0 evidence audit is durable, Phases 1-6 are
implemented, and the current closeout review found no unresolved medium-or-higher
workstream gaps.

The remaining PG `--promote-current` smoke is a deployment-environment operation
and is tracked as a low-severity follow-up in `GAP-LEDGER.md`.

## Findings

| Finding | Status | Severity | Resolution |
|---------|--------|----------|------------|
| Phase 1 depended on evidence investigated before this workstream existed | closed | medium | Phase 0 summary now records baseline facts, direct notice evidence, supporting notice classification and boundary freeze |
| Roadmap originally mixed schema completion with notice-derived source admission | closed | medium | Phase 2 owns source artifact admission; Phase 3 owns reconciliation |
| `course_suspension` and `normal_rest_day` lacked a concrete projection contract | closed | high | Phase 1 added accepted record families and validation coverage |
| `春假` alias could become an implicit official event name | closed | high | Projection validation requires `event_alias_types["春假"] == "colloquial"` |
| Calendar/notice conflicts could be represented without precedence metadata | closed | high | Validation requires precedence/conflict metadata; release preview is `valid=true` with explained notice precedence |
| Workstream-touched handwritten files exceeded decomposition limit after implementation | closed | medium | Notice artifact parsing/reconciliation moved to `academic_calendar_source_artifacts.py`; Go notice fixture moved to `runtime_academic_calendar_notice_fixture_test.go` |
| Requirements listed exact queries that were only partially covered by adjacent cases | closed | medium | Added exact runtime coverage for `春季社会实践周是什么时候` plus planner and notice/card denominator coverage for `找春假通知原文` |

## Closeout Evidence

Fresh verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_academic_calendar_projection \
  tests.test_publish_academic_calendar_projection -q

cd apps/supervisor-api
go test -count=1 ./internal/structuredquery ./internal/structuredplanning

uv run --all-packages python -m unittest \
  tests.agent.campus_services_academic_calendar_suite \
  tests.evals.public_chat_product_path_eval_suite \
  tests.evals.public_chat_entry_e2e_suite -q

uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/academic_calendar_projection.py \
  packages/ingestion-core/src/campus_ingestion_core/academic_calendar_source_artifacts.py \
  packages/campus-services-agent/src/campus_services_agent/academic_calendar_adapter.py \
  tests/ingestion/test_academic_calendar_projection.py \
  tests/agent/campus_services_academic_calendar_suite.py \
  tests/evals/public_chat_product_path_eval_suite.py \
  tests/evals/public_chat_entry_e2e_suite.py

uv run --all-packages ruff format \
  packages/ingestion-core/src/campus_ingestion_core/academic_calendar_projection.py \
  packages/ingestion-core/src/campus_ingestion_core/academic_calendar_source_artifacts.py \
  packages/campus-services-agent/src/campus_services_agent/academic_calendar_adapter.py \
  tests/ingestion/test_academic_calendar_projection.py \
  tests/agent/campus_services_academic_calendar_suite.py \
  tests/evals/public_chat_product_path_eval_suite.py \
  tests/evals/public_chat_entry_e2e_suite.py --check

pnpm docs:lint
```

Observed results:

- projection/publish tests: `Ran 12 tests ... OK`
- Go structured-query/planning tests: `ok`
- agent/eval tests: `Ran 14 tests ... OK`
- eval exact denominator supplement:
  `tests.evals.public_chat_product_path_eval_suite`
  `tests.evals.public_chat_entry_e2e_suite`: `Ran 8 tests ... OK`
- ruff check: `All checks passed`
- ruff format check: files already formatted
- docs lint: `Summary: 0 error(s)`

Release preview:

```bash
uv run --all-packages python scripts/publish_academic_calendar_projection.py \
  --output-dir var/academic-calendar-release \
  --generated-at 2026-05-07T00:00:00+08:00 \
  --report-path var/academic-calendar-release/report.json
```

Observed release evidence:

- `record_count=51`
- validation `valid=true`
- validation `issues=[]`
- current projection contains one `course_suspension`, one `workday_makeup` and
  one `normal_rest_day`
- `2026-05-09` is notice-derived `normal_rest_day` with source notices
  `355589` / `355682` and conflict ref
  `calendar:official_web:baseline-2026-05-09`

## Decomposition Review

The repo-wide decomposition gate still fails because many existing or parallel
workstream files exceed the threshold, but the two workstream-touched files that
were over budget no longer appear in the failure list.

Current line counts:

```text
42 apps/supervisor-api/internal/structuredplanning/planner_academic_calendar_notice_original_test.go
698 packages/ingestion-core/src/campus_ingestion_core/academic_calendar_projection.py
599 packages/ingestion-core/src/campus_ingestion_core/academic_calendar_source_artifacts.py
740 apps/supervisor-api/internal/structuredquery/runtime_academic_calendar_test.go
123 apps/supervisor-api/internal/structuredquery/runtime_academic_calendar_notice_fixture_test.go
```
