---
doc_type: phase_plan
status: completed
workstream: regulation-rag-release-lane
phase: phase-13-institutional-golden-retrieval-quality-follow-up
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 13 Plan: Institutional Golden Retrieval Quality Follow-Up

## Goal

Close the 3 golden retrieval gaps exposed after Phase 12 release without opening
`scoped_rules`, annual/cohort implementation rules or college-level scoped rules
to default `institutional_rules` consumption.

## Scope

- Keep the 42 released school-level `regulations/institutional_rules` documents
  as the only default regulation RAG serving scope.
- Investigate the positive recall gap for
  `中央民族大学研究生“三助”工作管理办法`.
- Add or evaluate retrieval/query-planning guard behavior for annual/cohort
  scope-membership questions.
- Add or evaluate retrieval/query-planning guard behavior for college-level
  scoped-rule decoy questions.

## Evidence Inputs

- `../../evidence/phase-12-institutional-42-quality-and-release/golden-retrieval-live-summary.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/golden-retrieval-gap-analysis.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/retrieval-live-summary.json`
- `../../evidence/phase-12-institutional-42-quality-and-release/runtime-readiness.report.json`

## Runtime Probe Contract

Runtime readiness evidence must be regenerated with:

```bash
uv run --all-packages campus-ingestion-probe-regulation-rag-release-runtime
```

The probe is intentionally single-source:

- it loads env through `load_worker_env()`;
- it checks the configured `QDRANT_URL` with API key on `/readyz`, `/livez` and
  `/collections`;
- it resolves the `institutional_rules` alias and point count from Qdrant;
- it reports embedding provider/model/key presence without printing secrets;
- it does not perform localhost TCP checks such as `127.0.0.1:6333`.

## Exit Criteria

- Release-gate retrieval remains passing for 45 cases.
- Golden retrieval no longer has the 3 recorded problem cases.
- No solution admits `scoped_rules` or annual/cohort rules into default
  `institutional_rules` serving.

## Completion Evidence

- `../../evidence/phase-13-institutional-golden-retrieval-quality-follow-up/retrieval-live-summary.json`
- `../../evidence/phase-13-institutional-golden-retrieval-quality-follow-up/golden-retrieval-live-summary.json`
- `./SUMMARY.md`
