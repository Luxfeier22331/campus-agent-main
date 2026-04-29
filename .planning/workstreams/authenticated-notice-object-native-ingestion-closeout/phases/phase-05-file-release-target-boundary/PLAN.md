---
doc_type: plan
status: completed
created: 2026-04-28
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: File-Release Target Boundary

## Goal

Remove `file_release` double truth by aligning docs, import code, inventory, and downstream stop point.

## Target Direction

Admit `authenticated_notice_portal/file_release` as an object-backed authenticated document source:

- target scope: `authenticated_documents/file_release_source`
- source surface: `file_release`
- required input: released original file object in source bucket
- stop point: document holding / inventory, not query-serving

This does not make `file_release` a `notice`, and it does not automatically promote anything to
`regulations/*`, `campus_services/*`, document center, or chat/panel serving.

## Implementation Steps

1. Update architecture docs and file-release contract from capture-only to explicit source posture.
2. Remove or rewrite language that says local PG capture is the continuing target.
3. Make `file_release_source` import require object-backed source bytes and object verification.
4. Ensure holding status reports distinguish:
   captured-only, object-backed source-ready, imported holding, downstream-admitted.
5. Add tests for stale object refs and valid object-backed import.
6. Update workstream state with the final posture.

## Tests / Verification

```bash
uv run --all-packages python -m campus_ingestion_worker.show_authenticated_document_holding_status \
  --collection file_release_source
uv run --all-packages python -m unittest tests.ingestion.test_authenticated_document_holding_status -q
pnpm docs:lint
git diff --check
```

## Exit Criteria

- `file_release` no longer has capture-only docs conflicting with active import behavior.
- Object-backed `file_release_source` does not open query-serving or downstream semantic promotion.
- Stale/missing released-file object refs are visible as blocked, not silently imported.
