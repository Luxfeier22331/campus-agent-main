---
doc_type: phase_plan
workstream: notice-agent-card-first-tool-boundary
phase: 02-go-runtime-finalizer-guard
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2: Go Runtime And Finalizer Guard

## Goal

Ensure Go-owned structured runtime, planner, workflow trace and final answer assembly cannot emit notice full body.

## Depends On

- Phase 1 contract and ToolSpec recut.

## Runtime Design

Go remains the deterministic runtime/control-plane owner. It should:

- Plan notice discovery as `campus_notice_discover`.
- Resolve selected notice references through an internal query function, not a provider-visible tool.
- Render direct notice answers as source card/link text:
  - title,
  - official/source URL,
  - published/effective date when available,
  - source family and short match reason/excerpt when policy allows.
- Store and pass bounded context through `StepOutputProjection`, not raw body.
- Fail closed if a path tries to render full `normalized_body`, OCR owner text or attachment body into public answer/trace.

## Work Packages

1. Update `apps/supervisor-api/internal/structuredplanning/planner.go`.
   - Replace selected notice follow-through planning from body-get tool to selected-ref/card/context resolution.
   - Keep multi-step workflow edges explicit when a later RAG step needs notice context.
2. Update `apps/supervisor-api/internal/httpapi/structured_direct_text.go`.
   - `ToolCampusNoticeDiscover` returns card list with URLs.
   - selected notice resolution returns card/link output.
   - no branch reads `normalized_body` into `answer_text`.
3. Update `apps/supervisor-api/internal/structuredquery/notice.go`.
   - Keep body store access internal.
   - Return card/context projection according to display policy.
   - Preserve authz/fail-close behavior for restricted notices.
4. Update workflow projection code:
   - `apps/supervisor-api/internal/execution/step_output_projection.go`
   - `apps/supervisor-api/internal/execution/bridge_payload.go`
   - contract validation under `apps/supervisor-api/internal/contracts/`
5. Add public-output leak guard.
   - Guard should scan final answer and workflow safe projection for forbidden notice-body fields/markers, not raw object content.
   - Guard must be deterministic and fail closed.

## Expected Test Updates

- `apps/supervisor-api/internal/httpapi/structured_direct_test.go`
- `apps/supervisor-api/internal/structuredplanning/planner_test.go`
- `apps/supervisor-api/internal/structuredquery/notice_test.go`
- `apps/supervisor-api/internal/execution/workflow_run_test.go`
- `apps/supervisor-api/internal/execution/workflow_run_store_test.go`
- `apps/supervisor-api/internal/contracts/supervisor_execution_contract_test.go`
- `tests/test_supervisor_runtime_process_smoke.py`

## Negative Cases

Tests must prove:

- A resolved notice result with `normalized_body` does not render the body into answer text.
- Workflow trace summary does not include body, OCR owner text or attachment body.
- Missing official URL fails closed rather than emitting body-only output.
- Restricted notice card resolution still requires principal, entitlement and restricted retrieval filter.

## Verification

```bash
(cd apps/supervisor-api && go test \
  ./internal/structuredplanning \
  ./internal/structuredquery \
  ./internal/httpapi \
  ./internal/execution \
  ./internal/contracts)
uv run --all-packages python -m unittest tests.test_supervisor_runtime_process_smoke -q
git diff --check
```

## Exit Criteria

- Go direct structured answer and workflow trace are card/link-only for notice.
- Selected notice context is bounded and operator-safe.
- Full-body leak guard has positive and negative tests.
