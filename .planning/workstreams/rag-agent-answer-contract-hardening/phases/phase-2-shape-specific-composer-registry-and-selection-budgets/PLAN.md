---
doc_type: plan
status: planned
created: 2026-05-10
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# Phase 2: Shape-Specific Composer Registry And Selection Budgets

## Goal

Route each short-answer shape into a dedicated composer and narrow the evidence budget so the
answer cannot accidentally expand into a long summary.

## Scope

- route title and document-identity cases away from generic summary composition
- route curriculum identity answers to a document identity response or one-fact answer, not a plan
  summary
- route official-web stable-reference brief answers to one or two facts only
- keep generic fallback as a true fallback for unsupported or ambiguous cases
- reduce selection breadth for short-answer kinds so the composer only sees the minimum support it
  needs
- align the per-shape budget with the frozen phase 0 contract matrix rather than widening the
  evidence pool opportunistically
- make the shape-specific dispatch explicit in `rag-agent` so title, curriculum identity and brief
  answers do not fall back to the generic summary path by accident

## Deliverables

- dedicated composers for the short-answer kinds in scope
- selection-budget adjustments for identity and brief shapes
- tests proving that short-answer paths no longer concatenate unrelated fragments
- selection diagnostics proving when the support set was narrowed
- dispatch coverage for title lookup, curriculum identity and official-web brief answers

## Verification

- targeted unit tests for each composer
- snapshot or string-length checks on title and brief answers
- `tests.agent.rag_agent_answer_quality_regression_suite`
- `tests.agent.rag_agent_curriculum_family_facts_suite`
- `tests.agent.rag_agent_curriculum_family_facts_course_suite`
- `tests.agent.rag_agent_curriculum_family_facts_program_suite`
- `tests.agent.rag_agent_official_web_reference_suite`

## Exit Criteria

- title and identity answers are visibly shorter than the current baseline
- curriculum identity answers stay at fact-sentence or identity-sentence length
- official-web brief answers stay within the frozen fact budget
- generic fallback no longer aggregates every available fragment
- shape-specific composers are the primary path for the in-scope queries
- selection budget changes are explicit and test-covered
