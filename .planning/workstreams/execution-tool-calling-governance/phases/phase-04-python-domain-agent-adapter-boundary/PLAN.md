---
doc_type: plan
phase: phase-04-python-domain-agent-adapter-boundary
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Python Domain-Agent Adapter Boundary

## Goal

Ensure Python worker and domain-agent delegates consume Go-owned `allowed_tools`
without re-inferring or expanding the tool set.

## Tasks

1. Add adapter boundary checks around `AgentRequest.allowed_tools`.
2. Reject payload/tool mismatches and wrong-family tools.
3. Ensure delegates only expose permitted thin adapters.
4. Add focused tests for missing, extra and disallowed tool cases.
5. Update Python worker docs if behavior changes.

## Write Scope

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/`
- `packages/*-agent/` adapter boundary files as needed
- focused Python tests

## Verification

```bash
uv run --all-packages python -m unittest tests.supervisor.agent_dispatch_suite
uv run --all-packages ruff check apps/supervisor-agent-worker packages tests
uv run --all-packages ruff format apps/supervisor-agent-worker packages tests --check
git diff --check
```
