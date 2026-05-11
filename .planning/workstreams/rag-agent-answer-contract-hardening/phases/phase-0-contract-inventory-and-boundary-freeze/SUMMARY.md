---
doc_type: phase_summary
status: completed
created: 2026-05-10
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 0 Contract Inventory And Boundary Freeze

## Result

Phase 0 is complete. It did not change production code. It froze the answer contract boundary for
the remaining phases and confirmed the current regression shape.

## Frozen Contract Matrix

| Kind | Current path | Freeze decision | Budget |
|---|---|---|---|
| `title_lookup` | `agent_answering.py -> agent_curriculum_answering.py / agent_official_web_answering.py / agent_answering_generic.py` | Dedicated short-answer path exists, but current implementation still allows long prose expansion in title-like cases. | 1 identity sentence, 1 title prefix, max 2 supporting fragments |
| `document_identity` | `agent_answer_shape.py -> agent.py -> agent_answering.py` | Same contract family as `title_lookup`; treat as a typed short-answer kind in later phases. | 1 identity sentence, max 2 supporting fragments |
| `brief_reference` | `agent_official_web_answering.py`, `agent_answering_generic.py` | Dedicated official-web brief/reference path exists and should stay bounded. | max 2 facts, max 2 fragments |
| `curriculum_identity` | `agent_curriculum_answering.py` | Dedicated path exists and must stay a fact sentence, not a plan summary. | 1 fact sentence, max 1 title prefix, max 2 fragments |
| `generic_fallback` | `agent_answering_generic.py` | Current fallback is too permissive and concatenates too many fragments. | 1 short sentence, max 2 fragments, no summary chain |

## Current Code Facts

- `packages/rag-agent/src/campus_rag_agent/agent.py:55-118` already computes `AnswerShape`, support
  budget, selected rows, typed draft validation and direct answer composition in one place.
- `packages/rag-agent/src/campus_rag_agent/agent_answering.py:22-69` already routes to specialized
  composers for procedure, official-web stable reference, curriculum semester course list and
  curriculum lookup before falling back to generic composition.
- `packages/rag-agent/src/campus_rag_agent/agent_answering_generic.py:14-37` still joins every
  selected fragment into one answer and only adds a light prefix/context label.
- `packages/rag-agent/src/campus_rag_agent/agent_curriculum_answering.py:30-99` already has narrow
  curriculum fact helpers, but the fallback branch still emits up to three joined statements.
- `packages/rag-agent/src/campus_rag_agent/agent_official_web_answering.py:37-171` already has
  separate reference / roster / news / notice composers and the notice branch only keeps a small
  fact set, but the generic reference fallback can still expand more than a short-answer contract
  should allow.
- `packages/rag-agent/src/campus_rag_agent/agent_selection_rows.py:36-162` already narrows support
  rows by shape, but `TITLE_LOOKUP` still needs stronger dedicated selection and composer routing.
- `packages/rag-agent/src/campus_rag_agent/agent_shared.py:163-172` already defines answer prefixes
  by corpus and keeps the user-facing answer language domain-aware.
- `packages/evals/src/campus_evals/ragas_diagnostic_fixtures.py:10-65` already freezes the current
  target ragas regression set for the four surface families.
- `packages/evals/src/campus_evals/operator_observability.py:13-35` already sets the current
  `answer_relevancy` gate at `0.75`.

## Regression Evidence

The current ragas diagnostic report shows the bug is synthesis-heavy, not retrieval-heavy:

- `policy-title-scholarship` score `0.8200`, answer length `389`
- `institutional-three-assists` score `0.7761`, answer length `432`
- `ethnology-plan-title` score `0.6879`, answer length `413`
- `stable-reference-school-profile` score `0.7427`, answer length `49`

Report:

- `.tmp/evals/ragas-smoke-answer-relevancy-20260510T184246+0800/ragas-diagnostic.answer_relevancy.json`

## Phase 1 Review

Phase 1 is directionally correct and low risk.

- Good: typed presentation kinds belong inside `packages/rag-agent`; they do not need to leak into
  `packages/contracts`.
- Good: the current code already has `TypedAnswerDraft` and draft validation, so Phase 1 can formalize
  what the code is already trying to do.
- Risk: if Phase 1 invents a broad schema instead of tightening the existing draft kinds, it will
  add a second answer taxonomy instead of stabilizing the current one.

## Phase 2 Review

Phase 2 is necessary and should be the first implementation phase to materially change answer
quality.

- Good: the current code already has route points for specialized composers.
- Good: `TITLE_LOOKUP` and curriculum identity can be routed away from generic summary composition.
- Risk: if `generic_fallback` stays eligible as the first answer path, the workstream will recreate
  the exact over-expansion bug this phase 0 freeze is trying to stop.
- Risk: selection budgets must be narrower than the current `DEFAULT_MAX_ANSWER_SOURCES = 3` path
  for title and identity cases, otherwise the answer can still expand even if the composer is typed.

## Phase 3 Review

Phase 3 should be a closeout phase, not a new design phase.

- Good: the current evaluation denominator already contains the target surfaces and the gate is
  observable.
- Good: phase 3 can simplify fallback and add diagnostics without reopening retrieval or ingestion.
- Risk: if phase 3 only tightens fallback text but does not lock presentation-kind diagnostics, the
  same bug will reappear in a different composer.
- Risk: the answer-relevancy regression set should stay frozen; phase 3 should not reopen dataset
  scope while trying to repair synthesis.

## Open Decision For Next Phase

Implement phase 1 as a schema and validation hardening step only. Do not expand scope into retrieval,
ingestion, or supervisor routing.

## Verification

No implementation verification ran in this phase. The phase is read-only by design and only froze
the contract boundary and regression evidence.
