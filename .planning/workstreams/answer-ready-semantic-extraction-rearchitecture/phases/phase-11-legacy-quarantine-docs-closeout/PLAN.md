---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 11: Legacy Quarantine Docs Closeout

## Goal

清理剩余技术债：把 old-index compatibility 明确隔离，移除目标路径 fallback，更新架构/政策文档，并用
`GAP-LEDGER.md` 完成 closeout audit。

## Scope

- Audit remaining runtime cue and fallback paths.
- Move allowed compatibility to named legacy old-index branch.
- Ensure v3 release profiles cannot use legacy primary path.
- Update architecture and policy docs.
- Close all gap ledger rows or explicitly block closure.
- Audit that Phase 0 frozen oracle, taxonomy admission, gate split and release entrypoints were
  actually followed.

## Deliverables

- Legacy compatibility quarantine implementation or deletion of obsolete fallback.
- Tests proving target v3 path fails if it enters legacy primary cue logic.
- Docs updates as needed:
  - `docs/architecture/system/data-plane-architecture.md`
  - `docs/architecture/system/retrieval-serving-architecture.md`
  - `docs/policies/student-handbook-chunking-and-validation-policy.md`
  - any regulation release lane docs touched by implementation
- `GAP-LEDGER.md` completion audit.
- `STATE.md` and `ROADMAP.md` status update.
- Reopen rule that names semantic oracle drift, release-entrypoint drift and fallback leakage.

## Implementation Boundaries

- Do not delete old-index read compatibility if still needed for safe historical operation; quarantine
  it instead.
- Do not claim target v3 completion while any legacy-signal primary path is allowed for target rebuilt
  releases.
- Do not update docs to claim merged truth before release evidence exists.

## Verification

```bash
pnpm docs:lint
pnpm yaml:lint
pnpm decomposition:lint
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
uv run --all-packages python -m unittest discover -s tests -t .
```

If JS/TS files are touched:

```bash
pnpm web:lint
pnpm web:typecheck
pnpm web:test
```

## Exit Criteria

- All planned gaps are closed or the workstream is explicitly blocked, not partially completed.
- Target v3 serving paths for both regulation scopes have release evidence.
- Legacy fallback is old-index-only and cannot satisfy target tests.
- Docs reflect final boundary without overclaiming.
- Workstream can move to completed with a precise reopen rule.
- Phase 0 decision artifacts have matching implementation/evidence rows in `GAP-LEDGER.md`.

## Non-Goals

- Create PR or commit unless requested.
- Open new products or retrieval surfaces.
