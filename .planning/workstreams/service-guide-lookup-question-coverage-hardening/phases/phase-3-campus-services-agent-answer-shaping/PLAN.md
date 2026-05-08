---
doc_type: phase_plan
workstream: service-guide-lookup-question-coverage-hardening
phase: phase-3-campus-services-agent-answer-shaping
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Campus Services Agent Answer Shaping

## Goal

Make `campus-services-agent` produce concise, focus-aware, source-safe service-guide answers for
the matrix cases.

## Inputs To Inspect

- `packages/campus-services-agent/src/campus_services_agent/tool_adapter.py`
- `tests/agent/test_campus_services_agent.py`
- `tests/agent/campus_services_agent_fakes.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_instruction_profiles.py`
- `QUESTION-MATRIX.md`

## Tasks

1. Add agent answer tests for each positive focus class using matrix `must_contain` /
   `must_not_contain` tokens.
2. Add unavailable wording tests for field-level fail-close results.
3. Assert forbidden internal vocabulary is absent:
   - `source_refs`
   - `release_id`
   - projection ids
   - raw object locators
4. Ensure observability safe details record selected focus and selected source summary only.
5. Update Agents SDK instruction profile only if the profile currently contradicts service-guide
   source URL semantics.
6. Update `MATRIX-COVERAGE-AUDIT.md` agent rows.
7. Update `STATE.md` with Phase 3 evidence.

## Exit Criteria

- Agent answers include only requested focus facts plus safe source labels/URLs.
- Missing fields produce explicit unavailable wording.
- No generic RAG fallback or transaction action appears in agent output.

## Completion Evidence

- Added answer-shaping coverage for entry URL answers, required-materials answers, contact answers,
  grouped procedure answers and full-guide answers.
- Added unavailable wording coverage for missing contact and missing entry URL fields.
- Verified safe observability details include selected focus and source summaries without exposing
  raw internal locators as user instructions.

## Verification

```bash
uv run --all-packages python -m unittest tests.agent.test_campus_services_agent -q
uv run --all-packages ruff check packages/campus-services-agent/src/campus_services_agent/tool_adapter.py tests/agent/test_campus_services_agent.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_instruction_profiles.py
git diff --check -- packages/campus-services-agent tests/agent apps/supervisor-agent-worker .planning/workstreams/service-guide-lookup-question-coverage-hardening
```
