---
doc_type: plan
status: completed
created: 2026-04-28
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Fail-Close Object And Dry-Run Gates

## Goal

Guarantee that stale object metadata and dry-run commands cannot mutate canonical stores.

## Implementation Steps

1. Add object verification before materialization:
   existence, byte size when known, sha256 when known.
2. Validate `file_release.released_file.object_key` and `sha256` before raw/document writes.
3. Add recording fake stores in tests for object store, raw registry, document registry, source-truth inventory, projection, and read model.
4. Assert `plan` / `dry-run` calls produce zero writes across all stores.
5. Assert missing/mismatched objects block all downstream writes.
6. Ensure error reports classify:
   `missing_bundle_object`, `missing_manifest_object`, `missing_source_bytes`, `checksum_mismatch`, `size_mismatch`.

## Tests / Verification

```bash
uv run --all-packages python -m unittest discover -s tests/ingestion -t . -q
uv run --all-packages ruff check packages/ingestion-core apps/ingestion-worker tests/ingestion
uv run --all-packages ruff format packages/ingestion-core apps/ingestion-worker tests/ingestion --check
git diff --check
```

## Exit Criteria

- Missing object refs cannot produce PG rows.
- Dry-run cannot write source bucket, registry, projection, read model, current pointer, or admission lifecycle.
- Failures are operator-readable and machine-checkable.
