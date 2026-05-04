---
doc_type: state
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# State: Supervisor Multi-Agent Runtime Contract Hardening

## Current Slice

Phase 0 completed. Architecture docs now explicitly require:

- repo-owned `AgentSpec` registry
- canonical `Turn -> WorkflowRun -> AgentInvocation -> ToolCall -> Evidence/Projection -> Finalization` lifecycle
- bounded context projection policy per domain agent
- external frameworks as implementation substrates only, not canonical runtime truth

## Next Step

Start Phase 1: design `AgentSpec` schema and initial registry inventory for:

- `rag-agent`
- `campus-services-agent`
- `notice-agent`
- `navigation-agent`

## Blockers

- None for planning.
- Implementation should not start until Phase 1-4 contract decisions are written and reviewed.

## Verification

Pending after Phase 0:

```bash
pnpm docs:lint
git diff --check
```

## Continuity Notes

- This workstream is about multi-agent runtime contract hardening, not Codex CLI usage workflow.
- Existing unrelated dirty worktree changes must remain untouched unless they overlap this slug.
- Treat `governed-multi-agent-workflow-runtime` as a deferred implementation/runtime workstream;
  this workstream prepares the contract and execution plan needed before reopening or replacing it.

