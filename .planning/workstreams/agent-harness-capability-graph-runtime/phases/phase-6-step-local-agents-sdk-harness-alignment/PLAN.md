---
doc_type: phase_plan
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Step-Local Agents SDK Harness Alignment

## Goal

Make SDK-backed and typed-tool-runtime steps converge on the same artifact envelope.

## Tasks

1. Standardize Python worker step runner input around expected artifacts.
2. Validate SDK structured output into repo-owned projection types.
3. Prove SDK cannot add tools outside Go `allowed_tools`.
4. Sanitize SDK trace into correlation fields only.
5. Map SDK errors/timeouts/guardrail failures to stable fail-close reasons.

## Exit Criteria

- SDK remains step-local.
- Shared contracts, panel, eval canonical truth and public responses contain no SDK-native types.

## Verification

```bash
uv run --all-packages python -m unittest tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_trace_projection_suite tests.supervisor.provider_function_calling_suite -q
cd apps/supervisor-api && go test ./internal/execution ./internal/httpapi
```

## Completion Evidence

- [supervisor-execution.openapi.yaml](/home/reptilian/code/campus-agent/docs/contracts/schemas/supervisor-execution.openapi.yaml)
- [generate_supervisor_execution_contracts.py](/home/reptilian/code/campus-agent/scripts/generate_supervisor_execution_contracts.py)
- [supervisor_execution_contract.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/contracts/supervisor_execution_contract.go)
- [supervisor_execution_contract.py](/home/reptilian/code/campus-agent/apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/generated/supervisor_execution_contract.py)
- [models_runtime.py](/home/reptilian/code/campus-agent/packages/contracts/src/campus_contracts/models_runtime.py)
- [bridge_payload.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/execution/bridge_payload.go)
- [bridge_v6_parser.py](/home/reptilian/code/campus-agent/apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_v6_parser.py)
- [agents_sdk_runner.py](/home/reptilian/code/campus-agent/apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_runner.py)
