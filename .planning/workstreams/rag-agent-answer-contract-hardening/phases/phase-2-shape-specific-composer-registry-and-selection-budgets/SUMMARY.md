---
doc_type: phase_summary
status: completed
created: 2026-05-11
updated: 2026-05-11
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 2 Shape-Specific Composer Registry And Selection Budgets

## Result

Phase 2 is complete. `packages/rag-agent` now routes short-answer shapes through explicit dedicated
composers instead of letting generic summary composition decide title / identity / brief answers.

## Changes

- `AnswerShape.TITLE_LOOKUP` now forces dedicated document-identity or brief-reference composition
  for the covered regulation, curriculum, and official-web paths.
- Added explicit title/document identity answer composition in
  `packages/rag-agent/src/campus_rag_agent/agent_answering.py`.
- Curriculum title lookup now prefers `_compose_curriculum_identity_answer(...)` instead of a plan
  summary path.
- Official-web stable-reference brief lookup stays on the dedicated official-web composer path and
  is capped to at most two fragments.
- Selection logic keeps `TITLE_LOOKUP` support budget narrow while still allowing a slightly wider
  candidate pool before selection so table-only first hits do not starve identity answers.
- Added explicit query cues for document-identity phrasing such as `哪份管理办法` / `依据哪份`.

## Evidence

- `packages/rag-agent/src/campus_rag_agent/agent_answering.py`
- `packages/rag-agent/src/campus_rag_agent/agent_answer_shape.py`
- `packages/rag-agent/src/campus_rag_agent/agent_curriculum_answering.py`
- `packages/rag-agent/src/campus_rag_agent/agent_official_web_answering.py`
- `packages/rag-agent/src/campus_rag_agent/agent_official_web_reference_school.py`
- `packages/rag-agent/src/campus_rag_agent/agent_selection_rows.py`
- `tests/agent/rag_agent_short_answer_contract_suite.py`
- `tests/agent/rag_agent_answer_quality_regression_suite.py`
- `tests/agent/rag_agent_official_web_reference_suite.py`

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_short_answer_contract_suite \
  tests.agent.rag_agent_official_web_reference_suite \
  tests.agent.rag_agent_answer_quality_regression_suite -q
```

Result: passed on 2026-05-11.

## Outcome

- Regulation and institutional title lookups now stay at document-identity length.
- Curriculum title lookups now stay at one fact / one reference answer length.
- Official-web stable-reference brief lookups no longer expand into longer page summaries.
