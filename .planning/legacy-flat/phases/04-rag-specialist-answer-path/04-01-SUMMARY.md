---
phase: 04-rag-specialist-answer-path
plan: "01"
subsystem: specialist
tags: [rag-specialist, clarification, retrieval-framing, handbook]
requires:
  - phase: 03.2-source-truth-fan-out-and-attachment-projection
    provides: stable handbook source truth and verified chunk-truth baseline
  - phase: 03-retrieval-corpus-preparation
    provides: registry-backed hybrid retrieval contract
provides:
  - clarification-first handbook request handling inside `rag-specialist`
  - proactive `needs_clarification` mapping for referential and target-missing queries
  - specialist-side preservation of the single `retrieve_sources()` retrieval seam
affects: [04-02, 04-03, rag-specialist, evals]
tech-stack:
  added: []
  patterns: [clarification-first routing, conservative specialist-local ambiguity gate]
key-files:
  created: [.planning/phases/04-rag-specialist-answer-path/04-01-SUMMARY.md]
  modified:
    - packages/rag-specialist/src/campus_rag_specialist/service.py
    - tests/specialist/test_rag_specialist.py
    - tests/evals/test_golden_cases.py
key-decisions:
  - "Phase 4 consumes the accepted hybrid retrieval baseline instead of reopening retrieval strategy."
  - "Obvious referential or target-missing handbook questions fail closed to `needs_clarification` before unsafe retrieval."
  - "The specialist keeps `retrieve_sources()` as the only retrieval entrypoint."
duration: inline
completed: 2026-03-27
---

# Phase 04 Plan 01 Summary

**Implemented clarification-first handbook request handling in `rag-specialist` without introducing a second retrieval path**

## Accomplishments

- Added explicit clarification gating for referential questions and generic target-missing queries in [`packages/rag-specialist/src/campus_rag_specialist/service.py`](/home/reptilian/code/campus-agent/packages/rag-specialist/src/campus_rag_specialist/service.py).
- Kept `retrieve_sources()` as the only retrieval boundary and prevented specialist-local strategy drift.
- Added focused regression coverage for referential clarification, generic scholarship clarification, and evidence-backed ambiguity in [`tests/specialist/test_rag_specialist.py`](/home/reptilian/code/campus-agent/tests/specialist/test_rag_specialist.py) and [`tests/evals/test_golden_cases.py`](/home/reptilian/code/campus-agent/tests/evals/test_golden_cases.py).

## Verification

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.specialist.test_rag_specialist tests.evals.test_golden_cases`
- `rg -n 'needs_clarification|follow_up_question|retrieve_sources|rewrite|clarif' packages/rag-specialist/src/campus_rag_specialist/service.py tests/specialist/test_rag_specialist.py tests/evals/test_golden_cases.py`

Both checks passed on 2026-03-27.
