---
doc_type: phase_plan
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Boundary And Current Truth Freeze

## Goal

Freeze the workstream boundary before implementation: `agent-harness-capability-graph-runtime`
owns capability/artifact graph planning, not global SDK orchestration or new product surface opening.

## Tasks

1. Confirm current repo truth:
   - `multi_step` current admitted path is selected notice context + knowledge follow-through.
   - governed multi-agent pilot is completed and should not be extended by tail work.
   - Agents SDK is step-local substrate and does not own global workflow graph.
2. Record external design references:
   - OpenAI Agents manager-style orchestration.
   - OpenAI Agents guardrails, tracing and eval guidance.
   - LangGraph durable execution semantics as implementation reference, not required dependency.
   - Anthropic workflow patterns as decomposition guidance.
3. Write native planning files:
   - `README.md`
   - `REQUIREMENTS.md`
   - `ROADMAP.md`
   - `READINESS-MATRIX.md`
   - `STATE.md`
4. Update `.planning/WORKSTREAMS.md` active registry entry.
5. Run docs/diff verification.

## Non-Goals

- No runtime code changes.
- No public product opening.
- No SDK global orchestration.
- No state-changing tools.

## Verification

```bash
pnpm docs:lint
git diff --check -- .planning/workstreams/agent-harness-capability-graph-runtime .planning/WORKSTREAMS.md
```

## Completion Evidence

- `CURRENT-TRUTH-AND-DESIGN-REVIEW.md`
- `README.md`
- `REQUIREMENTS.md`
- `READINESS-MATRIX.md`
- `.planning/WORKSTREAMS.md`
