---
doc_type: plan
status: completed
created: 2026-04-28
updated: 2026-04-28
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Worker Object-Ref Import

## Goal

Let ingestion worker import authenticated notice and file_release exports from object refs or run ledger.

## Primary Write Set

- `apps/ingestion-worker/src/campus_ingestion_worker/import_authenticated_notice_export.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/import_authenticated_notice_file_release_export.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_file_release_import.py`
- object-store helper/protocol modules inside ingestion-core
- `tests/ingestion/`

## Implementation Steps

1. Add request fields for object refs:
   `bundle_object_key`, `manifest_object_key`, `source_bucket`, optional `run_id`.
2. Add a Python run-ledger resolver for
   `run_id -> source surface/source bucket/bundle/manifest refs/hash/size/status`.
3. Load bundle/manifest bytes from object store and parse in memory.
4. Preserve explicit local path mode only for fixture/dev commands, with CLI wording reflecting that.
   Production/Docker examples must not use local bundle or manifest paths.
5. Add CLI/DTO-level guard for local path mode:
   - `--run-id` or explicit object refs are the mainline inputs.
   - bare `--bundle-path` / `--manifest-path` must fail closed.
   - local paths require an explicit fixture/dev guard such as
     `--allow-local-fixture-import` or a dedicated fixture command.
6. Apply the same object-ref shape and local path guard to notice and file_release importers.
7. Update worker README/runbook examples to use object refs.

## Tests / Verification

```bash
uv run --all-packages python -m unittest discover -s tests/ingestion -t . -q
uv run --all-packages ruff check apps/ingestion-worker packages/ingestion-core tests/ingestion
uv run --all-packages ruff format apps/ingestion-worker packages/ingestion-core tests/ingestion --check
```

## Exit Criteria

- Worker can import from object store without access to collector local filesystem.
- Missing `run_id` ledger row and missing explicit object refs fail with clear errors.
- Non-success or unverified ledger rows fail closed.
- Bare local path invocation fails closed in tests.
- Existing local fixture tests use the explicit fixture/dev guard and are not production handoff.

## Completion Notes

- Implemented notice and file-release request object-ref fields, `run_id`, and
  local fixture/dev guard.
- Added Python collector run-ledger resolver for verified object-backed runs.
- Added object-store bundle/manifest byte loader with optional hash/size
  verification.
- Updated worker CLIs and README examples for run-ledger/object-ref import.
- Added object-ref import, local-path rejection, and run-ledger validation tests.
