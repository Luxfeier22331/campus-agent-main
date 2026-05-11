---
doc_type: plan
status: planned
created: 2026-05-10
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# Phase 3: Fallback Tightening, Eval, And Closeout

## Goal

Lock the new answer contract with regression tests, eval evidence, and a narrowed fallback path.

## Scope

- simplify the generic fallback so it emits one short sentence instead of a summary chain
- add stage diagnostics for presentation kind, fallback reason and fallback path
- extend ragas smoke and unit coverage for the target title / brief cases
- confirm that answer relevancy returns above the current gate on the frozen regression cases
- verify that the low-score cases are attributable to the intended fallback path when fallback is
  actually used
- record the reopen rule and closeout boundary in the workstream docs
- close the workstream only after the eval evidence, code evidence and planning evidence all align

## Deliverables

- fallback-tightening patch
- regression tests for title / identity / brief answers
- ragas smoke evidence for the repaired cases
- stage diagnostics that distinguish presentation kind from retrieval / grounding failures
- closeout note for the new contract

## Verification

- targeted unit tests
- ragas smoke rerun against the frozen regression set
- repo lint / typecheck on changed files as needed
- eval artifact review for the frozen cases
- `tests.agent.rag_agent_answer_quality_regression_suite`
- `tests.evals.ragas_diagnostic_runner_suite`

## Exit Criteria

- target smoke passes the current relevancy gate
- short-answer regressions are covered by tests
- the fallback path is measurably narrower than the dedicated composers
- fallback usage is explainable from diagnostics instead of prose inspection
- the workstream can be reopened only if title / identity / brief answers expand again
