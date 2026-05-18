---
doc_type: plan
status: completed
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Phase 2: Query Planning Single Source

## Goal

Make query planning emit `RetrievalIntent` as the single source of downstream intent truth.

## Scope

- Regulation handbook planning.
- Institutional rules planning projection.
- Curriculum planning projection.
- Official-web stable reference projection.
- Clarification / unsupported intent handling.

## Implementation Tasks

1. Extend planning result objects to carry or expose a `RetrievalIntent` projection without making
   downstream answer/retrieval layers reclassify raw query text.
2. Map:
   - category discovery -> `policy_list`
   - specific policy + article/clause focus -> `specific_clause_lookup`
   - judgment questions -> `eligibility_judgment`
   - procedure questions -> `procedure_steps`
   - condition/requirement overview -> `condition_table`
   - institutional public service default -> `policy_list`
   - institutional governance target -> `policy_object_lookup`
   - version compare -> `version_compare`
   - curriculum lookup -> `curriculum_fact_lookup`
   - official reference -> `official_reference_lookup`
3. Preserve existing clarification behavior as `clarification_required`.
4. Keep existing task strings as read-only projections during the same phase; they must not remain
   independent owner truth after Phase 9.
5. Update planning tests to assert intent fields, not only task strings.

## Acceptance Criteria

- No downstream layer needs to infer primary intent from raw query text for covered scopes.
- Existing `HandbookQueryPlan.task_kind` and SDK task kinds are marked as projections, not owners.
- Existing user-visible behavior remains equivalent unless previously ambiguous behavior is now
  explicitly fail-closed or clarification-bound.

## Verification

```bash
uv run --all-packages python -m unittest tests.agent.test_rag_retrieval_plan tests.agent.rag_agent_handbook_category_discovery_suite -q
uv run --all-packages ruff check packages/rag-agent tests/agent
```
