---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 2 Release Retrieval Acceptance Gate

## Result

Registry-scope release now supports deterministic retrieval acceptance before alias publish.

Default query-enabled alias publish fails closed when `--acceptance-case-path` is missing, empty,
or failing. No-alias preview remains allowed without acceptance fixtures.

## Changes

- Added `campus_ingestion_core.index_release_acceptance`.
- Added release acceptance case loading, evaluator, and physical-collection Qdrant executor.
- Wired `release_registry_scope(..., acceptance_case_path=...)` and worker CLI
  `--acceptance-case-path`.
- Added acceptance summary artifacts:
  `retrieval-acceptance-summary.json`.
- Added release manifest/report fields:
  `retrieval_acceptance_status` and `retrieval_acceptance_summary_object_key`.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_regulation_serving_release_gates \
  tests.retrieval.test_backend_qdrant
```

Result: `Ran 115 tests in 4.741s` / `OK`.
