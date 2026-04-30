---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Plan: Phase 2 Release Retrieval Acceptance Gate

## Goal

Block alias publish unless the newly built physical collection passes deterministic retrieval
acceptance.

## Requirements

- Acceptance runs against the physical collection, not the current alias.
- Gate supports per-collection case fixtures.
- Gate covers positive qrels, hard negative/no-hit, authz, current-only/version filters, and
  evidence back-link.
- Gate is optional only for dry-run/no-alias preview.
- Publishing a query-serving alias without case fixtures fails closed; missing fixtures are not
  treated as an empty passing suite.
- Failure writes artifacts and does not publish alias.

## Implementation Tasks

1. Add RED tests.
   - New `tests/ingestion/test_index_release_acceptance.py`.
   - Cover passing physical collection, failed qrels, failed no-hit, failed authz, failed
     back-link, and missing required case path for query-serving publish.

2. Add acceptance case schema.
   - Suggested module: `campus_ingestion_core.index_release_acceptance`.
   - Fields: case id, corpus, collection, query, expected document/version/chunk ids,
     allowed visibility, target revision/version, negative expected no-hit, top_k threshold.
   - Mark case fixtures as required for query-serving publish.

3. Add physical collection executor.
   - Use retrieval-core backend with collection-name override or a bounded release-time
     adapter that reuses Qdrant query/filter/evidence builders.
   - Do not mutate alias.

4. Wire into release.
   - `release_registry_scope(..., acceptance_case_path=...)`.
   - Worker CLI `release_registry_scope.py` gains `--acceptance-case-path`.
   - `publish_scope_release` evaluates before alias publish.
   - Query-serving publish fails before alias mutation when `acceptance_case_path` is missing
     or empty.

5. Write acceptance artifacts.
   - Store summary under the release operation prefix or release prefix before alias publish.
   - Include case counts, pass/fail, failed case ids, and metric summary.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_regulation_serving_release_gates \
  tests.retrieval.test_backend_qdrant
uv run --all-packages ruff check <touched-python-files>
uv run --all-packages ruff format <touched-python-files> --check
```

## Done Criteria

- Publishing alias can be blocked by failed retrieval acceptance.
- Publishing query-serving alias is blocked by missing acceptance fixtures.
- Preview/no-alias release remains possible for operator inspection.
- Acceptance artifacts are durable and linked from release report or manifest.
