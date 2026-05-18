---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: Guardrails And Observability

## Goal

Prevent unsupported service-guide answers and emit operator-safe trace details for section
selection.

## Inputs

- Phase 4 `SUMMARY.md`
- `packages/campus-services-agent/src/campus_services_agent/tool_adapter.py`
- `apps/supervisor-api/internal/httpapi/finalizer_observability.go`
- `apps/supervisor-api/internal/httpapi/finalizer_workflow_summary.go`
- `packages/evals/fixtures/workflow_trace_gate_cases.v1.json`

## Tasks

1. Add deterministic service-guide guardrails:
   - selected section ids must exist in result details
   - every rendered fact must have source refs
   - missing requested field must be `source_not_provided` / fail-close
   - unrelated sections must not be rendered for narrow focus
2. Emit agent observability:
   - selected service id/name
   - requested guide focus
   - selected section ids
   - omitted section ids/reasons
   - missing requested fields
   - source refs used
   - guardrail verdict
3. Ensure safe details do not expose:
   - raw source bundle content
   - object locators
   - raw HTML/provider payloads
4. Extend workflow trace fixtures/gates if service-guide observability shape changes.

## Acceptance Criteria

- Unsupported fields produce `temporarily_unverifiable` / `no_answer` semantics.
- Guardrail blocks unrelated selected sections before final answer rendering.
- Agent observability includes selected/omitted sections and guardrail status.
- Workflow trace remains complete and operator-safe.

## Verification

```bash
uv run --all-packages python -m unittest tests.supervisor.agent_dispatch_suite
uv run --all-packages python -m unittest discover -s tests -t . -p '*workflow*'
go test ./internal/httpapi ./internal/structuredquery
uv run --all-packages ruff check packages/campus-services-agent packages/evals
```

## Done Summary Template

When complete, write `SUMMARY.md` with:

- guardrail checks
- observability fields
- redaction decisions
- changed trace/eval fixtures
- verification evidence
