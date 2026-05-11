---
doc_type: roadmap
status: completed
created: 2026-05-10
updated: 2026-05-11
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Rag-Agent Answer Contract Hardening

## Phase Status

- [x] **Phase 0: Contract Inventory And Boundary Freeze** — inventory every short-answer path and
  freeze the contract taxonomy, budgets, and diagnostics ownership.
- [x] **Phase 1: Typed Presentation Schema And Contract Taxonomy** — introduce explicit internal
  presentation kinds, draft validation rules, and shape compatibility checks without promoting the
  schema into shared contracts.
- [x] **Phase 2: Shape-Specific Composer Registry And Selection Budgets** — route title,
  curriculum identity, and official-web brief cases into dedicated composers and narrow evidence
  budgets.
- [x] **Phase 3: General Summary Tightening, Eval, And Closeout** — collapse general summary to a
  bounded presentation, add regressions, rerun ragas smoke, and close out the contract.

## Phase 0: Contract Inventory And Boundary Freeze

**Goal:** map the current answer-producing paths and decide exactly which short-answer contracts
need to exist before any implementation changes land.

**Scope:**

- inventory `agent_answering.py`, `agent_answering_generic.py`, `agent_curriculum_answering.py`,
  `agent_official_web_answering.py`, `agent_selection_rows.py`, `typed_answer_drafts.py`, and
  `agent_shared.py`
- identify every current title / identity / brief / generic answer shape
- record which cases should become typed short-answer contracts
- define the maximum answer budget for each short-answer contract
- define the diagnostics needed to explain which presentation path was used
- collect the current ragas regression cases that prove the bug

**Exit Criteria:**

- a contract matrix exists for title, identity, brief, and fallback answers
- the budget for each contract is written down before implementation starts
- the regression set for the low answer-relevancy cases is frozen

**Status:** completed.

**Evidence:** `./phases/phase-0-contract-inventory-and-boundary-freeze/SUMMARY.md`

## Phase 1: Typed Presentation Schema And Contract Taxonomy

**Goal:** make answer presentation kinds explicit so the composer can validate shape before it
renders text.

**Scope:**

- introduce an internal presentation schema for:
  - document identity
  - brief reference
  - short factual summary
  - general summary
- define validation rules for maximum fragments, maximum sentences, and allowed qualifiers
- keep the schema internal to `rag-agent` unless a concrete public consumer proves it is needed
- add unit tests for invalid overlong drafts and valid short-answer drafts

**Exit Criteria:**

- short-answer kinds are typed, not inferred from prose alone
- invalid overlong drafts fail fast
- the taxonomy is stable enough for composers and tests to share

**Status:** completed.

**Evidence:** `./phases/phase-1-typed-presentation-schema-and-contract-taxonomy/SUMMARY.md`

## Phase 2: Shape-Specific Composer Registry And Selection Budgets

**Goal:** route each short-answer shape into a dedicated composer and narrow the evidence budget so
the answer cannot accidentally expand.

**Scope:**

- route title and document-identity cases away from generic summary composition
- bound curriculum identity answers to a document identity response, not a plan summary
- bound official-web reference answers to one or two facts
- reduce selection breadth for short-answer kinds so the composer only sees the minimum support it
  needs
- keep general summary narrower than dedicated short-answer composers

**Exit Criteria:**

- dedicated composers exist for the short-answer kinds in scope
- title and identity answers are visibly shorter than the current baseline
- general summary no longer aggregates every available fragment

**Status:** completed.

**Evidence:** `./phases/phase-2-shape-specific-composer-registry-and-selection-budgets/SUMMARY.md`

## Phase 3: General Summary Tightening, Eval, And Closeout

**Goal:** lock the new contract with regression tests and eval evidence.

**Scope:**

- simplify general summary so it emits one short sentence instead of a summary chain
- add stage diagnostics for presentation kind and fallback-only degradation attribution
- extend ragas smoke and unit coverage for the target title / brief cases
- confirm that answer relevancy returns above the current gate on the target smoke cases
- record the reopen rule and closeout boundary in the workstream docs

**Exit Criteria:**

- target smoke passes the current relevancy gate
- short-answer regressions are covered by tests
- general summary is measurably narrower than the dedicated composers

**Status:** completed.

**Evidence:** `./phases/phase-3-fallback-tightening-eval-and-closeout/SUMMARY.md`
