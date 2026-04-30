---
doc_type: plan
phase: phase-08-provider-native-function-calling-runtime-pilot
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Plan: Provider-native Function Calling Runtime Pilot

## Goal

Prove provider-native function calling can run inside one domain-agent while Go
supervisor remains the admission and allowed-tools owner.

## Tasks

1. Select one low-risk read-only tool.
2. Generate strict provider function schema from ToolSpec.
3. Feed only Go-allowed tool schema to the provider loop.
4. Execute thin adapter and project bounded result.
5. Return normal `AgentResponse` and keep Go finalization unchanged.
6. Keep the runtime pilot behind explicit test-only or opt-in runtime gate.

## Write Scope

- one Python domain-agent adapter path
- provider function calling adapter helper
- focused tests and fixtures

## Verification

```bash
uv run --all-packages python -m unittest tests.agent tests.supervisor.agent_dispatch_suite
uv run --all-packages ruff check apps/supervisor-agent-worker packages tests
git diff --check
```
