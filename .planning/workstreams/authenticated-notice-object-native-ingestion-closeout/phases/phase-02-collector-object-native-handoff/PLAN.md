---
doc_type: plan
status: planned
created: 2026-04-28
updated: 2026-04-28
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Collector Object-Native Handoff

## Goal

Make collector success depend on verified source-bucket artifacts, not local export files.

## Primary Write Set

- `apps/authenticated-notice-collector/src/artifact-store.ts`
- `apps/authenticated-notice-collector/src/bootstrap-export-core.ts`
- `apps/authenticated-notice-collector/src/file-release-export-core.ts`
- `apps/authenticated-notice-collector/src/collector-run-ledger.ts`
- collector tests under `apps/authenticated-notice-collector/test` or existing test surface

## Implementation Steps

1. Extend artifact store with `headObject` / verify capability.
2. Add direct payload upload helpers for bundle and manifest.
3. Record `StoredArtifactRef` for bundle, manifest, and required source bytes.
4. Write run ledger verification summary:
   required object count, verified count, missing count, checksum mismatch count.
5. Extend run status beyond success-only:
   `started`, `success`, `failed`.
6. Add or migrate stable ledger columns needed by the Python worker reader:
   source bucket, object refs, hash/size, verification status, failure reason.
7. Fail collector run if required object writes or post-write verification fail.
8. Keep local files only as optional retained operator artifacts, never as worker handoff truth.

## Tests / Verification

```bash
pnpm --filter @campus/authenticated-notice-collector test
pnpm web:lint
git diff --check
```

## Exit Criteria

- A collector run cannot publish a success handoff without verified bundle and manifest object refs.
- File-release `object_store_write` cannot succeed while released file object refs are missing.
- The ledger has enough stable fields for worker `--run-id` import without reading local paths.
- Tests cover upload failure and verify failure paths.
