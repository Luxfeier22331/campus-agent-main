---
doc_type: phase_plan
status: completed
workstream: regulation-rag-release-lane
phase: phase-14-institutional-answer-and-product-path-acceptance
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 14 Plan: Institutional Answer And Product-Path Acceptance

## Goal

Prove the released 42 school-level `regulations/institutional_rules` documents
are consumable beyond retrieval metrics: answer-level source identity contracts
pass, and the supervisor product path can delegate to `rag-agent` with the
restricted campus-member authorization projection required by the published
institutional rule payloads.

## Scope

- Keep default regulation consumption limited to 42 school-level
  `institutional_rules`.
- Run deterministic answer-quality acceptance across all 42 institutional
  titles.
- Add a dedicated `rag_delegate_institutional_rules` process smoke profile for
  the supervisor product path.
- Ensure the product-path smoke request uses
  `entitlement_groups=["campus_members"]`, `visibility_level="restricted"` and
  `visibility_scope="campus"`.
- Keep `scoped_rules`, annual/cohort implementation rules and college-level
  implementation rules outside default `institutional_rules` consumption.

## Evidence Inputs

- `../../evidence/phase-13-institutional-golden-retrieval-quality-follow-up/retrieval-live-summary.json`
- `../../evidence/phase-13-institutional-golden-retrieval-quality-follow-up/golden-retrieval-live-summary.json`
- `../../../../../packages/evals/fixtures/institutional_rules_answer_quality_cases.v1.json`

## Exit Criteria

- Answer-quality contract passes for 42 institutional answer cases.
- Product-path smoke reaches supervisor-api, supervisor-agent-worker, rag-agent
  delegation and `retrieval.query` for `institutional_rules`.
- Product-path smoke returns a grounded answer with retrieved
  `institutional_rules` sources and does not return `no_answer`.
- Product-path smoke does not require opening `scoped_rules` or adding annual /
  college-level regulations to default serving.

## Completion Evidence

- `../../evidence/phase-14-institutional-answer-and-product-path-acceptance/institutional-answer-quality-observations.json`
- `../../evidence/phase-14-institutional-answer-and-product-path-acceptance/answer-quality-contract/profile-report.json`
- `../../evidence/phase-14-institutional-answer-and-product-path-acceptance/product-path-smoke/process-smoke-summary.json`
- `./SUMMARY.md`
