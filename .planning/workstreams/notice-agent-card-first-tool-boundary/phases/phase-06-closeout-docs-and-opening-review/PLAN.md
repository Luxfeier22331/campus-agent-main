---
doc_type: phase_plan
workstream: notice-agent-card-first-tool-boundary
phase: 06-closeout-docs-and-opening-review
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 6: Closeout Docs And Opening Review

## Goal

Close the workstream with docs, guardrails, and a serving opening review for the card-first notice runtime.

## Depends On

- Phase 0-5 completed and verified.

## Documentation Design

Update docs only after implementation proves the target state:

- `docs/contracts/campus-notice-runtime-contract.md`
  - final tool/function boundary,
  - `campus_notice_get` disposition,
  - result/display policy contract,
  - public-output leak invariant.
- `docs/architecture/target-architecture.md`
  - keep high-level target state synchronized.
- `docs/architecture/system/execution-and-agents-architecture.md`
  - final supervisor/agent/tool/SDK boundary.
- `docs/architecture/current-architecture.md`
  - only if implementation is merged truth on `develop`.
- `packages/evals/README.md`
  - updated denominator and guardrail meaning.

## Opening Review Design

Create `OPENING-REVIEW.md` with separate decisions:

- Card-first notice discovery readiness.
- Selected notice source-card resolution readiness.
- Summary/fact extraction readiness.
- Downstream materialization readiness.
- Restricted notice authz readiness.
- SDK/provider-loop readiness.

Each decision must be `open`, `gate-closed`, or `deferred`, with evidence links to tests/fixtures.

## Closeout Artifacts

- `CLOSEOUT.md`
  - phases completed,
  - verification commands,
  - final runtime posture,
  - known defers.
- Updated `STATE.md`
  - status and next action.
- Updated `.planning/WORKSTREAMS.md`
  - move to completed only when implementation and opening review pass.

## Reopen Rule

After closeout, reopen this workstream only if:

- a notice body-serving path reappears in public answer, workflow trace, panel, eval asset or provider/SDK tool output,
- `campus_notice_get` or another body/context function re-enters top-level ToolSpec/provider schema,
- SDK/provider runtime bypasses Go allowed-tools / ToolSpec derivation,
- restricted notice body/context is exposed without authorization projection,
- downstream materialization starts passing raw notice body as cross-agent prompt context.

## Verification

```bash
pnpm docs:lint
pnpm exec markdownlint-cli2 ".planning/workstreams/notice-agent-card-first-tool-boundary/**/*.md"
(cd apps/supervisor-api && go test ./internal/...)
uv run --all-packages ruff check apps/supervisor-agent-worker packages/notice-agent packages/evals tests
uv run --all-packages python -m unittest discover -s tests -t .
git diff --check
```

## Exit Criteria

- Docs, implementation and evals agree on card-first notice semantics.
- Opening review explicitly separates card-first runtime readiness from downstream materialization readiness.
- Workstream can be completed or left active with clear defers.
