---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Plan: Isolated Selected-Write Publish Proof

## Goal

Prove selected-write publish behavior in an explicitly accepted local target environment after
no-promotion evidence is clean.

## Inputs

- Phase 7 `SUMMARY.md`
- selected-write release tooling
- local PostgreSQL target
- local S3-compatible object storage target
- app-api operator-safe release task projection ingestion path

## Tasks

1. Declare local target environment before publish:
   - PostgreSQL connection/database/schema identity
   - object-store endpoint/bucket/prefix
   - selected-write target list
   - cleanup/rollback command
   - evidence retention directory
2. Confirm the declared target is isolated from developer default source-truth and product current
   state.
3. Run selected-write release for impacted service-guide targets only.
4. Verify:
   - release catalog row
   - `structured_projection_current` pointer
   - typed service-guide read model
   - operator-safe release projection snapshot
   - runtime query path reads grouped procedure fields from typed read model
5. Compare publish result against Phase 7 preview:
   - task-scope count
   - full-impact count
   - selected target names
   - field-source coverage
6. Run cleanup or record retained local artifacts according to declared policy.

## Acceptance Criteria

- Publish proof is isolated and cannot accidentally promote into default/local product state.
- Release task scope and full-impact counts match Phase 7 preview.
- Runtime reads grouped procedure fields from typed read model after publish.
- Cleanup/retention evidence is recorded.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_release_official_web_selected_write
go test ./internal/structuredquery ./internal/httpapi
uv run --all-packages python -m scripts.eval_gate accept --profile campus-services-product-path --json
```

## Done Summary Template

When complete, write `SUMMARY.md` with:

- local target declaration
- publish command and result
- read-model/runtime evidence
- preview-vs-publish comparison
- cleanup/retention evidence
- verification evidence
