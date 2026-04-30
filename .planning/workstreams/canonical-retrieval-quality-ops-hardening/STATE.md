---
doc_type: state
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Canonical Retrieval Quality Ops Hardening

## Current Status

- status: `active`
- current slice: Phase 0 completed; Phase 1 is next
- owner: current Codex session
- active implementation: Phase 1 qrels denominator policy / fixture validator expansion next
- latest completed phase: Phase 0 `Scope And Denominator Freeze`
- next phase: Phase 1 `Qrels And Acceptance Expansion`
- status note: `gsd-sdk workstream.status` reports any phase directory with `PLAN.md` and no
  `SUMMARY.md` as `in_progress`; ROADMAP `Status:` lines remain the human execution truth for
  planned-but-not-started phases in this workstream.

## Captured Context

2026-05-01 planning context:

- `canonical-retrieval-release-hardening` is completed and should not be reused for the remaining
  quality / ops gaps.
- Current release-managed retrieval path already has release acceptance, chunk quality, qrels
  coverage, release provenance, runtime drift guard, embedding cache identity, payload index audit,
  JSONL observation sink and deterministic rerank eval branch.
- Remaining gaps are quality and operations maturity:
  - qrels / acceptance fixtures are still bootstrap-sized.
  - real-scale release cost / latency / capacity evidence is not yet captured.
  - runtime observation is still JSONL-first instead of a durable production intake.
  - reranker is eval-only, not governed by a production opt-in gate.
  - `freshness_sensitive` / `live_assisted` remain target/deferred branches.
  - focused workstream gates and repo-wide dirty-worktree gates need clearer separation.

2026-05-01 Phase 0 context:

- Phase 0 evidence is captured at
  `evidence/phase-00-scope-and-denominator-freeze/inventory.md`.
- Current default query-enabled scopes are `regulations/student_rules`,
  `regulations/institutional_rules`, `curriculum/curriculum_plan` and
  `official_web/stable_reference`.
- `validate_default_query_enabled_qrels_coverage()` currently reports `issues 0`.
- The current gap is not missing basic fixtures; it is that normalized denominator classes and
  collection policies should become machine-checkable planning / eval truth rather than duplicated
  hard-coded release constants.

## Blockers

- No external blocker for Phase 0 planning and denominator freeze.
- Later phases may require real Qdrant / object store / embedding provider credentials for
  benchmark and smoke evidence.
- Repo-wide validation is currently expected to remain noisy because unrelated workstreams have
  dirty files; this workstream must use focused gates until integration cleanup.

## Verification Plan

Baseline planning/docs gate:

```bash
pnpm exec markdownlint-cli2 \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/canonical-retrieval-quality-ops-hardening/README.md \
  .planning/workstreams/canonical-retrieval-quality-ops-hardening/REQUIREMENTS.md \
  .planning/workstreams/canonical-retrieval-quality-ops-hardening/ROADMAP.md \
  .planning/workstreams/canonical-retrieval-quality-ops-hardening/STATE.md \
  .planning/workstreams/canonical-retrieval-quality-ops-hardening/phases/**/*.md
```

Phase implementation gates will be recorded in the phase summaries as they are executed.

## Continuity Notes

- Do not reopen or edit `canonical-retrieval-release-hardening` unless its explicit reopen rule is hit.
- Keep this workstream scoped to retrieval quality / ops; do not absorb authenticated-notice,
  campus-services tools, public web UI, or unrelated CI cleanup.
- Treat runtime observations as eval/backlog intake only; they do not mutate release truth.
- Keep raw query text disabled by default in any production observation path.
