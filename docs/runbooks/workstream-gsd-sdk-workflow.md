---
doc_type: runbook
truth_scope: repository
owner_boundary: docs/runbooks
status: active
created: 2026-06-04
updated: 2026-06-08
---
# GSD SDK And Codex Native Workflow

## Purpose

This runbook defines the day-to-day workflow after the repo cleanup that removed
tracked workstream/phase/archive directories from branch tip.

GSD SDK is the workstream planning control plane. Codex native sessions are the
execution runtime. The repo does not maintain its own harness, lease, heartbeat,
terminal-result artifact, hook injection, or tracked phase tree.

## Current Tracked Planning Truth

Only these planning files are tracked:

- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`
- `.planning/config.json`

Historical workstream, quick, milestone, research, todo, codebase, seed, and plan
archives are recovered through git history when needed. Recover only the useful
decision/evidence fragment into an active doc, ADR, runbook, contract, schema, or
compact planning file. Do not restore the archive tree.

## Common Commands

```bash
gsd-sdk query workstream.list --raw --cwd "$PWD"
gsd-sdk query workstream.status <workstream-slug> --raw --cwd "$PWD"
gsd-sdk query workstream.set <workstream-slug> --raw --cwd "$PWD"
gsd-sdk query workstream.progress --raw --cwd "$PWD"
```

Use plain Codex for discussion, architecture review, implementation, debugging,
test execution, code review, commits, and closeout.

## Feature Worktree Bring-up

After creating a feature worktree, create only the local env files required by
the current task or expose them through the developer's local secret manager. Do
not copy secrets between worktrees and do not add repo scripts that fan out
ignored `.env` / `.dev.vars` files. Deploy and staging checkouts use their own
ops-owned env files and secret stores.

## Scenario Routing

### New Feature

1. Confirm the owner area in `.planning/WORKSTREAMS.md`.
2. If working inside `.worktrees/*`, run the feature worktree bring-up command.
3. Use GSD SDK when the work spans multiple modules or needs persistent workstream
   coordination.
4. Use Codex directly for narrow implementation.
5. Persist durable contract/architecture changes before or with implementation.

### Requirement Change During Development

1. Update the active GSD/Codex work context.
2. If the change alters a long-term boundary, update ADR / architecture /
   contract / schema first.
3. Implement against the updated truth.
4. Verify with the relevant local gate and, for release work, the staging
   runbook.

### Change Completed Functionality

1. Identify whether this is product, execution, tool, data-plane, or ops.
2. Recover historical context through git history only if it contains a specific
   useful decision or evidence reference.
3. Do not restore old phase directories to restart work.
4. Land the change through normal branch, test, commit, and review flow.

### Architecture Evaluation Without Implementation

1. Keep the evaluation as a doc/ADR/runbook note if it should persist.
2. Mark unaccepted proposals clearly.
3. Do not write speculative implementation status into `.planning/PROJECT.md`.

### Architecture Constraint Update

1. Update the canonical ADR / architecture / contract / schema.
2. Update `AGENTS.md` only when the repo entry protocol or source-of-truth list
   changes.
3. Run residue checks for old terminology if the update supersedes a runtime
   model.

### Documentation Drift

1. Identify the source of truth.
2. Update the stale doc or the implementation that drifted.
3. Prefer deleting stale archive material over carrying parallel narratives at
   branch tip.

## Closeout Expectations

- No fallback or migration path is added unless an external migration
  constraint is explicit.
- Important decisions are committed to docs/ADRs/runbooks/contracts/schemas, not
  only chat context.
- Local scratch, runtime evidence, generated reports, and secrets stay out of the
  tracked repo unless the relevant runbook explicitly defines a tracked artifact.
