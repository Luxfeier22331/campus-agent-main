---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Summary: Scope And Denominator Freeze

## Completed

- Confirmed this workstream is not a reopen of `canonical-retrieval-release-hardening`.
- Inventoried current default query-enabled scopes:
  - `regulations/student_rules`
  - `regulations/institutional_rules`
  - `curriculum/curriculum_plan`
  - `official_web/stable_reference`
- Confirmed `regulations/scoped_rules` remains retrieval-ready but default-off.
- Confirmed campus notices, campus services and fresh/news surfaces remain outside this workstream.
- Ran the current default qrels coverage validator and observed `issues 0`.
- Recorded fixture case counts, classes and declared scenarios.
- Froze a normalized qrels denominator taxonomy for Phase 1.
- Recorded Phase 1-6 verification matrix.

## Evidence

- `../../evidence/phase-00-scope-and-denominator-freeze/inventory.md`

## Verification

```bash
uv run --all-packages python - <<'PY'
from campus_evals.benchmark import validate_default_query_enabled_qrels_coverage
issues = validate_default_query_enabled_qrels_coverage()
print("issues", len(issues))
for issue in issues:
    print(issue)
PY
```

Result:

```text
issues 0
```

## Next

Proceed to Phase 1: make the qrels denominator policy machine-checkable outside hard-coded release
path constants, then expand fixtures / validators against the normalized scenario classes.
