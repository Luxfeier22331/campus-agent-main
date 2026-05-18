---
doc_type: roadmap
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Campus Agentic RAG Depth Completion

## Phase Status

- [x] **Phase 0: Planning Truth And Scope Freeze** — create native workstream truth and no-opening boundaries.
- [x] **Phase 1: Semantic Contract Summaries** — add safe planner/projection/replan/claim graph summaries.
- [x] **Phase 2: RAG Runtime Plumbing** — emit planner information needs and diagnostics from existing runtime stages.
- [x] **Phase 3: Agentic Eval Attribution** — extend eval schema and failure classes for depth gaps.
- [x] **Phase 4: Focused Verification And Closeout** — run focused gates and update workstream state.

## Phase 0: Planning Truth And Scope Freeze

**Status:** completed.

**Exit Criteria:**

- Workstream appears in `.planning/WORKSTREAMS.md`.
- README / REQUIREMENTS / ROADMAP / STATE define scope and no-opening rules.

## Phase 1: Semantic Contract Summaries

**Status:** completed.

**Exit Criteria:**

- `packages/contracts` exports only safe summary models.
- Tests prove summaries reject raw payload keys and executable retrieval types remain private.

## Phase 2: RAG Runtime Plumbing

**Status:** completed.

**Exit Criteria:**

- Planner stage emits information needs.
- RAG diagnostics include planner, projection, replan and claim/evidence summaries.

## Phase 3: Agentic Eval Attribution

**Status:** completed.

**Exit Criteria:**

- Eval observations and fixtures support planner quality, replan reasons and claim graph verdicts.
- Failure classes are separated for decomposition, replan and claim graph regressions.

## Phase 4: Focused Verification And Closeout

**Status:** completed.

**Exit Criteria:**

- Focused unit tests pass.
- Scoped ruff / format / markdown / diff checks are recorded in STATE.
