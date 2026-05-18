---
doc_type: phase_summary
status: completed
workstream: regulation-rag-release-lane
phase: phase-13-institutional-golden-retrieval-quality-follow-up
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 13 Summary: Institutional Golden Retrieval Quality Follow-Up

## Outcome

Phase 13 closed the 3 golden retrieval gaps found after the Phase 12
`institutional_rules` release without changing the release alias, adding
`scoped_rules` to default consumption, or admitting annual/cohort implementation
rules.

The retrieval no-hit policy now supports the institutional title alias
`助教/助研/助管 -> 三助`, so the query
`研究生助教助研助管工作应该依据哪份管理办法？` retrieves
`中央民族大学研究生“三助”工作管理办法`.

The same policy now fail-closes explicit institutional scope-membership questions
that name annual/cohort implementation rules or college-level implementation
rules. This prevents adjacent released school-level rules from being returned as
evidence for questions asking whether an excluded annual/cohort or college-level
rule is within default校级制度 consumption.

## Evidence

- `../../evidence/phase-13-institutional-golden-retrieval-quality-follow-up/retrieval-live-run.json`
- `../../evidence/phase-13-institutional-golden-retrieval-quality-follow-up/retrieval-live-summary.json`
- `../../evidence/phase-13-institutional-golden-retrieval-quality-follow-up/golden-retrieval-live-run.json`
- `../../evidence/phase-13-institutional-golden-retrieval-quality-follow-up/golden-retrieval-live-summary.json`

## Counts

- Release-gate live retrieval cases: 45
- Release-gate doc_hit@1: 1.0
- Release-gate doc_hit@3: 1.0
- Release-gate doc_recall@5: 1.0
- Release-gate forbidden_hit_rate: 0.0
- Golden retrieval cases: 89
- Golden retrieval doc_hit@1: 1.0
- Golden retrieval doc_hit@3: 1.0
- Golden retrieval doc_recall@5: 1.0
- Golden retrieval forbidden_hit_rate: 0.0
- Previously recorded golden gaps closed: 3

## Closed Cases

- `institutional-golden-scenario-49319e7c44d3`: now retrieves
  `institutional_regulation:muc:中央民族大学研究生-三助-工作管理办法:49319e7c44d3`.
- `institutional-golden-hard-negative-annual-postgraduate-recommendation-2026`:
  now returns no sources for the excluded `2026届` annual/cohort implementation
  scope-membership query.
- `institutional-golden-scoped-rule-decoy-history-school`: now returns no sources
  for the college-level scoped-rule scope-membership query.

## Boundary

- `scoped_rules` remains closed to default query-serving.
- `中央民族大学2026届推荐应届本科毕业生免试攻读硕士学位研究生实施办法` remains excluded
  as an annual/cohort-specific scoped rule.
- The fix is retrieval policy/query-planning guard behavior only; it does not
  republish the Qdrant alias, change the Phase 12 42-document release truth, or
  change the default `institutional_rules` serving scope.
