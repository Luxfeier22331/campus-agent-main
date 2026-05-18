---
doc_type: gap_ledger
status: completed
created: 2026-05-10
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# Gap Ledger: Eval

## Completion Audit

This ledger maps the completed eval workstream to its accepted success criteria. It is not a new
implementation plan.

- Shared eval substrate ownership:
  `packages/evals`, `scripts.eval_gate`, eval artifact contracts, and profile registry/audit are
  owned by the eval workstream and recorded in `STATE.md`. Status: closed.
- Runtime / artifact / publish lifecycle:
  Phase 1-4 completed shared formal benchmark runtime, artifact lifecycle, repair/accept,
  publish/backflow, CI and release gate automation. Status: closed.
- Case governance scaffold:
  Phase 5A completed case lifecycle, denominator registry scaffold, workflow trace artifact model,
  candidate intake, review decisions and drift/admission discipline. Status: closed.
- Golden dataset current-corpus governance:
  Phase 5B current-corpus layer completed for the current query-enabled surfaces with retrieval
  qrels, release acceptance, answer-quality contracts, known-gap/no-hit checks and coverage audit.
  Status: closed.
- Workflow trace and product-path gates:
  Phase 6-13 completed workflow trace runtime gate, observed regression review, public-chat product
  path, tool-family denominator, document quality, authz/privacy, agentic retrieval plan and eval
  operations governance. Status: closed.
- RAG-only coverage/audit:
  `rag-eval-coverage-report-v2` records `minimum_gate_passed=true`, `maturity_passed=true`, and no
  maturity gaps for the current RAG denominator. Status: closed.
- Source unavailable canonical regulations:
  Missing authenticated canonical regulation sources remain protected by known-gap/no-hit cases and
  are moved to backlog seed `SEED-005`. Status: backlog, not eval blocker.

## Current RAG Denominator

- `regulations/student_rules`
- `regulations/institutional_rules`
- `curriculum/curriculum_plan`
- `official_web/stable_reference`

`official_web/fresh_news` remains explicitly excluded from current RAG eval denominator as
`not_current_rag_consumption_surface`.

## Known Residual Backlog

`中央民族大学本科生创新教育学分认定管理办法` is not in the current document library as canonical
source text. Eval keeps related innovation-credit queries in
`packages/evals/fixtures/rag_known_gap_cases.v1.json` so nearby documents or notice references do
not become accepted truth by accident.

The follow-up owner is backlog seed
`.planning/seeds/SEED-005-authenticated-canonical-regulation-gap-collection.md`.

## Verification Evidence

- `uv run --all-packages python -m campus_evals.rag_eval_coverage --output
  .planning/workstreams/eval/evidence/rag-eval-coverage/rag-eval-coverage.json --json`
- `uv run --all-packages python -m unittest tests.evals.rag_eval_coverage_suite
  tests.evals.rag_known_gap_suite tests.evals.answer_quality_contract_suite
  tests.evals.case_governance_suite tests.evals.profile_registry_and_audit_suite`
- `uv run --all-packages python -m scripts.eval_gate audit --json`

## Handoff

- New query-enabled surfaces must enter eval through denominator registry and release/coverage
  evidence, not by editing planning status text.
- Authenticated canonical regulation collection should reopen from `SEED-005` as a source/domain
  workstream. It should update source truth, document-site/RAG consumption and eval fixtures
  together.
- Reopen eval only if shared eval governance, profile registry, release gate, coverage/audit or
  known-gap/no-hit contracts drift.
