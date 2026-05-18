---
doc_type: phase_plan
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Evidence Selection And Claim Grounding Hardening

## Objective

Prevent low faithfulness/relevancy regressions by requiring final claims to be backed by
answer-bearing evidence and grounding verdicts.

## Dependencies

- Phase 2 planner/source-trust diagnostics are available or confirmed unnecessary for grounding.
- Phase 0 identifies current evidence and grounding failure classes.

## Desired End State

- Title/entity matches are selection hints only.
- Each completed answer has answer-bearing supporting evidence.
- Prompt-generated claims are validated against selected evidence.
- Unsupported or contradictory evidence produces no-answer, caveat or clarification.
- Diagnostics expose claim support and unsupported fields without raw payload leakage.

## Primary Code Targets

- `packages/rag-agent/src/campus_rag_agent/service_evidence_stage.py`
- `packages/rag-agent/src/campus_rag_agent/agent_selection.py`
- `packages/rag-agent/src/campus_rag_agent/agent_selection_rows.py`
- `packages/rag-agent/src/campus_rag_agent/agent_selection_statements.py`
- `packages/rag-agent/src/campus_rag_agent/agent_answering.py`
- `packages/rag-agent/src/campus_rag_agent/agent_answering_generic.py`
- `packages/rag-agent/src/campus_rag_agent/service_answer_synthesis.py`
- `packages/rag-agent/src/campus_rag_agent/grounding_validation.py`
- `packages/rag-agent/src/campus_rag_agent/retrieval_adequacy.py`
- `packages/rag-agent/src/campus_rag_agent/confidence.py`
- `packages/rag-agent/src/campus_rag_agent/service_diagnostics_payload.py`
- `packages/contracts/src/campus_contracts/models_retrieval.py`

## Primary Test Targets

- `tests/agent/rag_agent_answer_quality_regression_suite.py`
- `tests/agent/rag_agent_answer_grounding_suite.py`
- `tests/agent/rag_agent_request_prompt_grounding_suite.py`
- `tests/agent/rag_agent_official_web_reference_suite.py`
- `tests/agent/rag_agent_curriculum_structured_lookup_named_document_suite.py`
- `tests/agent/rag_agent_curriculum_family_facts_program_suite.py`
- `tests/agent/rag_agent_curriculum_family_facts_course_suite.py`
- `tests/agent/rag_agent_curriculum_family_facts_schedule_suite.py`
- `tests/evals/ragas_diagnostic_runner_suite.py`

## TDD Plan

1. Add failing evidence tests:
   - title-only hit does not produce `completed`.
   - entity-only hit without answer text does not support a factual claim.
   - stable official-web evidence must contain answer-bearing text, not just page identity.
2. Add failing claim coverage tests:
   - each final answer claim maps to a source ref or claim support.
   - unsupported field count increments when prompt output contains unsupported details.
   - contradiction between selected evidence and answer causes downgrade.
3. Add failing deterministic answer tests:
   - curriculum structured answers use textual support for required fact fields.
   - regulation answers include citation/back-link when completed.
4. Add failing eval diagnostics test:
   - low faithfulness due to unsupported claim is attributed to grounding/evidence, not retrieval.

## Implementation Steps

1. Define answer-bearing evidence rules.
   - Regulations: source text must contain the relevant policy clause or actionable condition.
   - Curriculum: source text or structured fact evidence must support program/course/semester claim.
   - Official-web stable reference: source text must support service/contact/reference statement.
2. Strengthen evidence selection.
   - Rank title/entity hits as hints.
   - Require supporting text before final selected evidence is considered adequate.
   - Preserve retrieval plan/step provenance on selected support.
3. Strengthen grounding validation.
   - Validate prompt answers against selected evidence.
   - Emit `claim_supports`, `unsupported_fields`, `grounding_verdict` and source-trust summary.
   - Downgrade unsupported prompt answers to no-answer/fallback.
4. Strengthen deterministic synthesis.
   - Ensure deterministic curriculum/regulation answers do not bypass evidence coverage.
   - Keep existing good deterministic answers where evidence is sufficient.
5. Update diagnostics and eval.
   - Add failure attribution for `unsupported_by_evidence`, `contradictory_evidence`,
     `answer_bearing_evidence_missing` or equivalent stable names.

## Write Set

Allowed:

- RAG evidence/grounding/synthesis files listed above
- Safe contract diagnostics summary fields if needed
- Focused agent and eval tests
- Phase summary/state

Not allowed:

- Collection-specific one-off hacks for individual titles
- RAGAS judge-only release authority
- Ingestion canonicalization changes unless Phase 0 proves an implementation cannot be tested
  without a fixture-level adjustment

## Verification

Run focused tests:

```bash
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_answer_quality_regression_suite \
  tests.agent.rag_agent_answer_grounding_suite \
  tests.agent.rag_agent_request_prompt_grounding_suite \
  tests.agent.rag_agent_official_web_reference_suite \
  tests.agent.rag_agent_curriculum_structured_lookup_named_document_suite \
  tests.agent.rag_agent_curriculum_family_facts_program_suite \
  tests.agent.rag_agent_curriculum_family_facts_course_suite \
  tests.agent.rag_agent_curriculum_family_facts_schedule_suite \
  tests.evals.ragas_diagnostic_runner_suite
```

Run lint/format:

```bash
uv run --all-packages ruff check \
  packages/rag-agent/src/campus_rag_agent \
  packages/contracts/src/campus_contracts \
  packages/evals/src/campus_evals \
  tests/agent tests/evals
uv run --all-packages ruff format \
  packages/rag-agent/src/campus_rag_agent \
  packages/contracts/src/campus_contracts \
  packages/evals/src/campus_evals \
  tests/agent tests/evals \
  --check
```

## Exit Criteria

- Completed answers require answer-bearing evidence.
- Title/entity hits cannot independently satisfy answer success.
- Unsupported/contradictory claims are downgraded deterministically.
- Diagnostics and RAGAS attribution identify evidence/grounding failure.
- Phase summary records evidence coverage rules per admitted surface.

## Risks

- Risk: stricter grounding lowers answer completion rate.
  Mitigation: prefer safe no-answer over unsupported completion; track denied/completed counts in
  eval output.
- Risk: deterministic structured curriculum answers bypass prompt grounding.
  Mitigation: add structured answer tests with evidence field requirements.
- Risk: diagnostics become too verbose.
  Mitigation: expose counts and source refs, not raw evidence text.
