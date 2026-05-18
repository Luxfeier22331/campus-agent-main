---
doc_type: phase_plan
workstream: agents-sdk-domain-agent-adapter-pilot
phase: 0
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Workstream Admission And Boundary Freeze

## Goal

Create the native workstream and freeze the boundary for introducing OpenAI Agents SDK as a
domain-agent adapter pilot.

## Tasks

- Create native workstream directory.
- Add `README.md`, `REQUIREMENTS.md`, `ROADMAP.md`, and `STATE.md`.
- Add repo registry entry under Active.
- Record non-goals preventing SDK from replacing Go supervisor, ToolSpec, contracts, data-plane
  truth, or eval truth.
- Record relationship to completed `execution-tool-calling-governance` and deferred
  `governed-multi-agent-workflow-runtime`.

## Acceptance Criteria

- Workstream has a clear active entry and phase sequence.
- Phase 1 can begin without revisiting architecture ownership.
- Docs lint and diff check pass.

## Verification

```bash
pnpm docs:lint
git diff --check
```
