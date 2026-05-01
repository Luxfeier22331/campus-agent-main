---
doc_type: phase_plan
workstream: notice-agent-card-first-tool-boundary
phase: 05-downstream-workflow-integration
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 5: Downstream Workflow Integration

## Goal

Preserve legitimate downstream notice consumption while preventing raw body handoff to public answer, cross-agent prompt context, workflow trace or panel assets.

## Depends On

- Phase 1 bounded context projection contract.
- Phase 2 Go workflow projection guard.
- Phase 4 eval denominator.

## Workflow Design

Downstream consumers should not call notice body as a general tool. They should consume in this order:

1. Dedicated materialized read model for current facts.
   - schedule baseline / override read model,
   - service status read model,
   - service guide read model,
   - regulation/RAG indexed documents.
2. `NoticeContextProjection` only as evidence for recent-change, ambiguity resolution or citation.
3. Source-truth raw body/OCR/media only inside offline materialization or explicitly bounded fact extraction, never as cross-agent prompt dump.

## Context Projection Shape

`NoticeContextProjection` should carry:

- `projection_id`
- `source_step_id`
- `notice_ref`
- `content_hash`
- `source_url`
- `body_excerpt`
- `bounded_summary`
- `extracted_facts`
- `provenance_refs`
- `attachment_refs`
- `display_policy`

It must not carry:

- full `normalized_body`
- OCR owner text
- inline image text
- attachment body
- raw object locator bytes or raw object content

## Work Packages

1. Update workflow projection builders in Go.
2. Update bridge payload context projection handling if Python RAG/service agents receive bounded context.
3. Update multi-step notice -> RAG follow-through tests so the handoff passes refs/summaries/facts rather than body.
4. Verify schedule/status/service-guide flows prefer materialized structured runtime.
5. Add regression cases where a notice contains a long body but downstream receives only bounded projection.

## Expected Test Updates

- `apps/supervisor-api/internal/execution/bridge_payload_test.go`
- `apps/supervisor-api/internal/execution/step_output_projection_test.go`
- `apps/supervisor-api/internal/structuredplanning/planner_test.go`
- `tests/test_supervisor_runtime_process_smoke.py`
- `tests/supervisor/agent_handoff_suite.py`
- `tests/supervisor/agents_sdk_trace_projection_suite.py` if SDK trace still observes workflow projections.

## Verification

```bash
(cd apps/supervisor-api && go test ./internal/execution ./internal/structuredplanning)
uv run --all-packages python -m unittest \
  tests.test_supervisor_runtime_process_smoke \
  tests.supervisor.test_agent_handoff \
  tests.supervisor.test_agents_sdk_trace_projection
git diff --check
```

## Exit Criteria

- Downstream workflows retain source-linked evidence.
- No raw notice body is passed as cross-agent context.
- Current-fact questions prefer dedicated structured runtime over notice explanation.
