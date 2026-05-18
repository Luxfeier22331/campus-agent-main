---
doc_type: phase_plan
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 0: Scope Inventory And Done Definition Freeze

## Goal

建立不可降级的完成定义：明确 v2 closeout 已完成什么、v3 还要消除什么债务、哪些证据才算
`student_rules` 与 `institutional_rules` 进入 target serving truth。

## Scope

- Read existing v2 closeout implementation and docs.
- Inventory current metadata production, payload projection, ranking consumption, release gate and
  eval attribution.
- Freeze no-debt target criteria.
- Freeze semantic correctness oracle.
- Freeze taxonomy admission and value-change governance.
- Freeze institutional-rule denominator and early sample coverage.
- Freeze static release-gate vs query-conditioned eval boundary.
- Freeze fallback budget and old-index compatibility lane.
- Freeze release adoption proof requirements.

## Deliverables

- `INVENTORY.md`
  - current fields and producers
  - current consumers
  - heuristic lineage map
  - missing semantic correctness checks
- `DONE-DEFINITION.md`
  - target v3 completion criteria
  - negative completion criteria
  - release and alias proof requirements
- `FALLBACK-BUDGET.md`
  - fallback classifications
  - old-index-only allowance
  - target v3 zero primary text-cue rule
- `RELEASE-ADOPTION-PROOF.md`
  - required manifest fields
  - pre-publish acceptance
  - alias publish/adoption evidence
  - post-publish audit evidence
- `SEMANTIC-ORACLE.md`
  - target samples for both mandatory regulation scopes
  - expected query intent
  - expected evidence role
  - expected `condition_subject`
  - expected polarity
  - expected `condition_group_id` behavior
  - expected category coverage
  - expected typed draft kind
  - expected grounding requirement
- `RELEASE-LANE-ENTRYPOINTS.md`
  - concrete command templates for:
    - `uv run --all-packages python -m campus_ingestion_worker.admit_regulation_rag_release`
    - `uv run --all-packages python -m campus_ingestion_worker.enqueue_regulation_rag_release_candidates`
    - `uv run --all-packages python -m campus_ingestion_worker.process_regulation_rag_release_candidates`
    - `uv run --all-packages python -m campus_ingestion_worker.release_registry_scope`
    - `uv run --all-packages python -m campus_ingestion_worker.scope_alias`
  - required environment prerequisites
  - required output fields
  - artifact paths to capture in Phase 9/10 summaries
  - explicit dry-run vs publish posture
- `TAXONOMY-ADMISSION.md`
  - controlled-value owner
  - alias review rule
  - unknown/degraded handling
  - release invalidation policy when taxonomy version changes
  - no one-off value rule
- `INSTITUTIONAL-DENOMINATOR.md`
  - institutional documents/categories sampled before Phase 10
  - institutional semantic oracle rows
  - institutional unit/chunk/retrieval fixture owners
- `STATIC-VS-QUERY-GATES.md`
  - static metadata checks allowed in chunk/release gates
  - query-conditioned assertions owned by retrieval/component eval
  - examples of invalid gate placement
- Updated `GAP-LEDGER.md`.

## Implementation Boundaries

- No production code changes in this phase except planning/test inventory helpers if absolutely
  required.
- Do not reopen architecture decisions.
- Do not change release profiles, aliases or runtime allowlists.

## Verification

Run documentation checks after writing phase artifacts:

```bash
pnpm docs:lint
```

If inventory helper tests are added, also run:

```bash
uv run --all-packages python -m unittest <added-test-module> -q
```

## Exit Criteria

- Every success criterion in `REQUIREMENTS.md` maps to a phase and an evidence type.
- The plan explicitly says field presence alone is insufficient.
- `institutional_rules` adoption is a blocker, not follow-up.
- Old-index fallback cannot satisfy target v3 completion.
- `GAP-LEDGER.md` records open debts with phase owners.
- Concrete release-lane entrypoints are bound before Phase 9/10 can execute.
- Semantic oracle is frozen before Phase 4/6/8 expand tests.
- Static release-gate checks are separated from query-conditioned ranking/eval checks.
- Institutional-rule samples are selected before implementation phases depend on student-rule-only
  tests.

## Non-Goals

- Implement v3 schema.
- Rebuild any collection.
- Tune ranking.
