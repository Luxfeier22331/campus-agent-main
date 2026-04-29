---
doc_type: plan
status: planned
created: 2026-04-28
updated: 2026-04-28
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Contract And Boundary Freeze

## Goal

Freeze the object-native collector -> worker handoff before implementation.

## Required Decisions

- Handoff identity: `run_id` is the stable operation handle; bundle/manifest object refs are the durable payload handles.
- Object-store identity: `source_bucket` is a first-class contract field; Docker
  workers must not infer it from collector-local paths or volume layout.
- Run-ledger access: collector writes stable columns and worker reads them through a Python-owned resolver contract.
- Accepted source surfaces: `notice` and `file_release` remain sibling surfaces under `authenticated_notice_portal`.
- `notice` canonical source unit remains stable notice.
- `file_release` is fixed as explicit
  `authenticated_documents/file_release_source` object-backed document source.
  It stays outside `notice` source-truth and outside query-serving.

## Implementation Steps

1. Update authenticated notice architecture with the target chain:
   `Docker collector -> source bucket + run ledger -> Docker worker`.
2. Add a handoff contract section:
   `run_id`, `source_surface`, `source_bucket`, `bundle_object_key`,
   `bundle_content_sha256`, `bundle_byte_size`, `manifest_object_key`,
   `manifest_content_sha256`, `manifest_byte_size`, `verification_status`,
   `verified_at`.
3. Add run-ledger read contract:
   source bucket, source surface, status, object refs, hash/size, verification summary,
   failure reason, and stable lifecycle timestamps.
4. Add required object role matrix:
   - `handoff_bundle`
   - `handoff_manifest`
   - `notice_attachment_source_bytes`
   - `file_release_released_source_bytes`
5. Update file-release export contract so `local_path` is not a cross-runtime handoff field.
6. Update ingestion-worker README with object-ref import as the mainline and local path as fixture/dev-only.
7. Freeze the Phase 6 / Phase 7 acceptance evidence paths under this workstream.
8. Add a Phase 1 summary to `STATE.md`.

## Tests / Verification

```bash
pnpm docs:lint
git diff --check
```

## Exit Criteria

- No planning document describes local export files as the system handoff truth.
- Handoff contract explicitly includes `source_bucket` and required object role semantics.
- `file_release` target posture is explicit enough for Phase 5 implementation.
- `run_id` import has a Python-readable ledger resolver contract before Phase 3.
- Phase 6 / Phase 7 acceptance artifacts have stable paths.
- Phase 2 and Phase 3 write sets are clear.
