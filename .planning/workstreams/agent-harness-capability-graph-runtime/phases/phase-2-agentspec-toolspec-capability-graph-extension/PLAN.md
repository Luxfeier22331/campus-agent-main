---
doc_type: phase_plan
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: AgentSpec / ToolSpec Capability Graph Extension

## Goal

Make artifact producer/consumer ownership machine-readable.

## Tasks

1. Consume `configs/runtime/workflow-artifacts.v1.json` as the artifact vocabulary.
1. Normalize `calendar_fact` naming drift by replacing it with `academic_calendar_facts` or making
   the alias explicit in validation.
1. Extend registry schema or add a sidecar config for artifact graph metadata.
1. Add `produces`, `consumes`, `required_inputs`, `source_truth_owner`, `freshness_policy`,
   `answer_eligible`, `requires_grounding`, `state_changing`, `opening_gate` and `eval_denominator`.
1. Populate initial matrix for selected notice, RAG, campus-services and navigation artifacts.
1. Add drift guards:
   - closed tools cannot produce query-time answer artifacts;
   - state-changing tools cannot enter harness;
   - ambiguous producers fail unless explicit priority exists;
   - `campus_notice_get` cannot become top-level provider/SDK tool.
1. Write `CAPABILITY-GRAPH.md`.
1. Add drift tests proving AgentSpec context projection kinds are registered artifacts or explicit
   aliases.

## Exit Criteria

- Resolver can depend on registry/config truth.
- Adding an artifact producer requires registry/eval changes, not planner if-else edits.
- No hidden projection-kind vocabulary exists outside the artifact registry.

## Verification

```bash
uv run --all-packages python -m unittest tests.supervisor.workflow_artifact_registry_loader_suite tests.supervisor.workflow_artifact_registry_suite tests.supervisor.agent_spec_registry_suite tests.supervisor.tool_spec_registry_suite -q
uv run --all-packages ruff check tests/supervisor/workflow_artifact_registry_loader_suite.py tests/supervisor/workflow_artifact_registry_suite.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/workflow_artifact_registry.py
uv run --all-packages ruff format tests/supervisor/workflow_artifact_registry_loader_suite.py tests/supervisor/workflow_artifact_registry_suite.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/workflow_artifact_registry.py --check
cd apps/supervisor-api && go test ./internal/runtimepolicy
pnpm exec markdownlint-cli2 '.planning/workstreams/agent-harness-capability-graph-runtime/**/*.md'
git diff --check -- .planning/workstreams/agent-harness-capability-graph-runtime apps/supervisor-api/internal/runtimepolicy/artifact_registry.go apps/supervisor-api/internal/runtimepolicy/artifact_registry_test.go apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/workflow_artifact_registry.py configs/runtime/workflow-artifacts.v1.json tests/supervisor/workflow_artifact_registry_loader_suite.py tests/supervisor/workflow_artifact_registry_suite.py
```

## Completion Evidence

- `configs/runtime/workflow-artifacts.v1.json`
- `CAPABILITY-GRAPH.md`
- [artifact_registry.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/runtimepolicy/artifact_registry.go)
- [artifact_registry_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/runtimepolicy/artifact_registry_test.go)
- [workflow_artifact_registry.py](/home/reptilian/code/campus-agent/apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/workflow_artifact_registry.py)
- [workflow_artifact_registry_loader_suite.py](/home/reptilian/code/campus-agent/tests/supervisor/workflow_artifact_registry_loader_suite.py)
