---
doc_type: phase_plan
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Gate Separation And Closeout

## Objective

固定本 workstream 的 focused gate、affected gate、repo-wide gate 与 known unrelated blocker
记录方式，并完成 closeout。

## Tasks

1. Record focused Python gates for ingestion/retrieval/evals touched by this workstream.
2. Record JS/TS affected/root gate expectations where docs or runtime shell changes touch web/apps.
3. Update retrieval architecture and index release runbook.
4. Update `.planning/WORKSTREAMS.md`, `STATE.md`, and `ROADMAP.md`.
5. Record remaining real-smoke blockers separately from implementation gaps.
6. Define reopen rule.

## Verification

- Focused unit/eval gates for touched modules.
- Targeted docs lint for retrieval docs and workstream files.
- `git diff --check`.
- Repo-wide gate status documented, including unrelated blockers if present.

## Exit Criteria

- Workstream status can move to completed.
- Remaining risks are operationally explicit, not hidden as implementation ambiguity.
- Future retrieval quality/ops gaps have a clear reopen rule or new-workstream trigger.
