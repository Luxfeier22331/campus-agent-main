---
doc_type: gap_ledger
status: completed
created: 2026-05-11
updated: 2026-05-16
---

<!-- markdownlint-disable MD013 -->

# Gap Ledger: Rag-Agent Answer Contract Hardening

## Completion Audit

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Title / identity queries must return one short identity-style answer instead of a summary chain | closed | `packages/rag-agent/src/campus_rag_agent/agent_answering.py`, `packages/rag-agent/src/campus_rag_agent/agent_answer_shape.py`, `tests/agent/rag_agent_short_answer_contract_suite.py`, `tests/agent/rag_agent_answer_quality_regression_suite.py` |
| Curriculum title lookup must stay on a one-fact identity-style path rather than a curriculum summary | closed | `packages/rag-agent/src/campus_rag_agent/agent_curriculum_answering.py`, `packages/rag-agent/src/campus_rag_agent/agent_answering.py`, `tests/agent/rag_agent_short_answer_contract_suite.py` |
| Official-web stable-reference brief answers must stay within a one-to-two fact budget | closed | `packages/rag-agent/src/campus_rag_agent/agent_official_web_answering.py`, `packages/rag-agent/src/campus_rag_agent/agent_official_web_reference_school.py`, `tests/agent/rag_agent_official_web_reference_suite.py`, `tests/agent/rag_agent_short_answer_contract_suite.py` |
| Generic fallback must collapse to a real fallback sentence instead of concatenating every fragment | closed | `packages/rag-agent/src/campus_rag_agent/agent_answering_generic.py`, `packages/rag-agent/src/campus_rag_agent/agent_answering.py`, `tests/agent/rag_agent_short_answer_contract_suite.py`, `tests/agent/rag_agent_presentation_contract_suite.py` |
| Typed draft validation must reject presentation/shape mismatches and overlong short answers | closed | `packages/rag-agent/src/campus_rag_agent/answer_presentation_contract.py`, `packages/rag-agent/src/campus_rag_agent/typed_answer_drafts.py`, `tests/agent/rag_agent_presentation_contract_suite.py`, `tests/agent/rag_agent_typed_answer_drafts_suite.py` |
| Runtime/eval diagnostics must expose presentation kind and fallback path/reason | closed | `packages/rag-agent/src/campus_rag_agent/service_answer_synthesis.py`, `packages/rag-agent/src/campus_rag_agent/service_diagnostics_payload.py`, `packages/rag-agent/src/campus_rag_agent/service_stage_diagnostics.py`, `packages/evals/src/campus_evals/rag_stage_diagnostics.py`, `packages/evals/src/campus_evals/ragas_diagnostic_runner.py`, `tests/evals/rag_stage_diagnostics_suite.py`, `tests/evals/ragas_diagnostic_runner_suite.py` |

## Residual Boundaries

- This closeout hardens short-answer presentation and diagnostics only; it does not reopen
  retrieval baseline, ingestion metadata extraction, reranker rollout policy, supervisor routing,
  or product surface ownership.
- Remaining broad `answer_relevancy` / `faithfulness` debt belongs to later retrieval or synthesis
  workstreams, not this contract-hardening line.
- The presentation schema stays package-local to `packages/rag-agent`; shared contracts only expose
  observability fields needed for diagnostics.

## Post-Closeout RAGAS Regression Loop 2026-05-16

The 2026-05-16 loop addressed student-rules synthesis regressions discovered by RAGAS diagnostics
without reopening the completed eval workstream:

| Case | Prior symptom | Resolution | Verification |
|------|---------------|------------|--------------|
| `fixed-phrase-electrical-appliance` | `faithfulness = 0.7307692307692307`; RAGAS split `宿舍内只允许使用电脑、复读机...` into unsupported single-item exclusivity claims | condition-table synthesis now renders allowed-scope restrictions as `允许使用的范围包括...；其他电器...` | focused rerun: faithfulness/context precision/context recall all `1.0` |
| `policy-alias-national-scholarship-article-nine` | earlier focused run showed `faithfulness = 0.5` | current detail-clause synthesis no longer reproduced the failure; no extra code change was needed | focused rerun: faithfulness/context precision/context recall all `1.0` |
| `structured-disciplinary-relief-materials` | `faithfulness = 0.8333333333333334`; material answer source tail `依据...第七条` was judged as an extra unsupported claim | material requirement answers now render source attribution as `来源：...` rather than a factual `依据...` sentence | focused rerun: faithfulness/context precision/context recall all `1.0`; answer relevancy `0.982714818294652` |

Closeout batch evidence:

```bash
uv run --all-packages python -m campus_evals.ragas_diagnostic_runner \
  --output-dir .tmp/evals/ragas-loop-20260516-student-synthesis-closeout \
  --case-workers 1 \
  --case-id fixed-phrase-electrical-appliance \
  --case-id fixed-phrase-dormitory-lighting \
  --case-id policy-alias-national-scholarship-article-nine \
  --case-id structured-disciplinary-relief-materials \
  --case-id semantic-disciplinary-relief \
  --case-id semantic-student-appeal-after-discipline \
  --case-id semantic-student-hearing-rights
```

Result: 7/7 cases completed and passed. Faithfulness, context precision, and context recall each had
mean/min/max `1.0 / 1.0 / 1.0`.

Residual observation: `semantic-student-appeal-after-discipline` still reports
`answer_relevancy = 0.8263632114011665`, while faithfulness/context precision/context recall are all
`1.0` and failure attribution is `passed`. The answer is the direct supported procedure sentence:
`如对处分决定不服，可在接到学校处理或者处分决定书之日起10日内向学校学生申诉处理委员会提出书面申诉。`
This remains a non-blocking RAGAS answer-relevancy observation, not a synthesis or retrieval defect.
