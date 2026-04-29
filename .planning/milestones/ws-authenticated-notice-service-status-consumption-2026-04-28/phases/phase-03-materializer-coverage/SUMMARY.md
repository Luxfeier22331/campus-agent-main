---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 3 Summary: Materializer Coverage

<!-- markdownlint-disable MD013 -->

## Completed

- Expanded notice-derived service-status materialization beyond the original
  narrow transport sample.
- Added deterministic coverage for facility, IT platform, library,
  service-counter and facility trial-operation examples.
- Added deterministic rejection coverage so non-status, schedule-owned and
  service-guide-owned facts are not silently promoted.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_notice_derived_service_status_materialization
```

Result: covered again in the final Phase 7 verification set.

## Boundaries Preserved

- Materialization remains gated by consumer admission.
- Negative cases produce rejected-source records rather than runtime guesses.
