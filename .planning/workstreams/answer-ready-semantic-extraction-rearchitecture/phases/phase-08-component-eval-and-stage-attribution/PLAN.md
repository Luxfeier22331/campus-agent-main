---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 8: Component Eval And Stage Attribution

## Goal

让 E2E 暴露的问题可以系统归因到 extraction、retrieval、ranking、selection、draft、grounding 或
release admission，而不是只看最终回答是否通过。

## Scope

- Extend component eval schema.
- Add stage assertions for target realistic samples.
- Add release artifact assertions.
- Add legacy-signal budget assertions.
- Add per-scope dashboards or JSON summaries.
- Load or generate assertions from `SEMANTIC-ORACLE.md`.
- Assert release-lane artifacts named in `RELEASE-LANE-ENTRYPOINTS.md`.

## Deliverables

- Component eval runner updates in `packages/evals`.
- Scenario fixtures for:
  - ambiguous real student phrasing
  - category discovery
  - positive procedure
  - negative exclusion
  - eligibility judgment
  - table fact
  - no-hit / unsupported
- Stage-local expected fields:
  - intent
  - target scope/category/document
  - expected answer role
  - expected subject/polarity
  - expected draft kind
  - grounding requirement
  - release contract status
- Oracle-backed target matrix for both mandatory scopes.
- Static-vs-query gate classification in failure reports.
- JSON summary with failure stage counts.

## Implementation Boundaries

- RAGAS/supplemental judge may remain diagnostic only.
- Component eval must use deterministic assertions for release gates.
- Eval must not mutate runtime profile or alias.
- Eval must not redefine semantic expectations that Phase 0 froze.

## Verification

```bash
uv run --all-packages python -m unittest tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_closeout_audit_suite tests.agent.rag_agent_realistic_e2e_samples_suite -q
uv run --all-packages ruff check packages/evals tests/evals tests/agent
uv run --all-packages ruff format packages/evals tests/evals tests/agent --check
```

## Exit Criteria

- Failures carry one primary stage and optional secondary stage.
- Fallback primary-signal regressions fail component eval.
- Eval covers both `student_rules` and `institutional_rules` target samples.
- Eval artifacts can be attached to release audit evidence.
- Every target oracle row can be attributed to a stage on failure.
- Query-conditioned contradiction failures are attributed to retrieval/ranking/selection/draft or
  grounding, not release admission.

## Non-Goals

- Replace release admission.
- Make LLM judge a hard publish gate.
