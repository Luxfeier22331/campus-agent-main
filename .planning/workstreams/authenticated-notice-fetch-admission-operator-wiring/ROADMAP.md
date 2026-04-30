---
doc_type: roadmap
status: active
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Authenticated Notice Fetch Admission Operator Wiring

## Phase Status

- [x] **Phase 1: Operator Manifest Builder And Docs Wiring** — add ingestion-worker CLI, tests, collector README/runbook updates, and workstream registration.
- [ ] **Phase 2: Selected Notice E2E Smoke Evidence** — source-truth import and fetch request manifest are proven for real notice `355867`; selected collector export is blocked by expired authenticated portal session.

## Phase 1: Operator Manifest Builder And Docs Wiring

Goal: turn Phase 9's collector-side manifest input into a reproducible operator command.

Deliverables:

- ingestion-worker CLI for fetch request manifest generation.
- console script and package lazy export.
- tests for metadata-only omission, required/admitted owner collector admission rows, and missing selected notice fail-closed behavior.
- collector README update for default reference-only attachment behavior.
- bootstrap smoke runbook section for selected attachment fetch admission.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_authenticated_notice_attachment_fetch_request_manifest \
  tests.ingestion.test_authenticated_notice_attachment_fetch_request_manifest_worker -q
pnpm --dir apps/authenticated-notice-collector test -- bootstrap-export.test.ts config.test.ts
pnpm --dir apps/authenticated-notice-collector typecheck
uv run --all-packages ruff check \
  apps/ingestion-worker/src/campus_ingestion_worker/build_authenticated_notice_attachment_fetch_request_manifest.py \
  tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest_worker.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_fetch_request_manifest.py \
  tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest.py
uv run --all-packages ruff format \
  apps/ingestion-worker/src/campus_ingestion_worker/build_authenticated_notice_attachment_fetch_request_manifest.py \
  tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest_worker.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_fetch_request_manifest.py \
  tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest.py --check
pnpm docs:lint
git diff --check
```

## Phase 2: Selected Notice E2E Smoke Evidence

Goal: prove the full operator handoff with a real selected notice and current source-truth object store.

Deliverables:

- evidence directory with generated manifest.
- selected source-truth-only import evidence.
- selected collector export summary after refreshed portal auth.
- run ledger excerpt showing required/admitted owner byte verification behavior after collector export succeeds.
- import smoke or equivalent source-bucket handoff validation.

Current evidence:

- `evidence/phase-02-selected-notice-e2e-smoke/355867/import-plan.stdout.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/import-admit-source-truth-only.stdout.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/fetch-request-manifest.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/fetch-request-manifest.stdout.json`
- `evidence/phase-02-selected-notice-e2e-smoke/auth-check.stdout.json`
- `evidence/phase-02-selected-notice-e2e-smoke/355867/selected-collector-export.stdout.json`

Blocked item:

- `pnpm --dir apps/authenticated-notice-collector auth:check` currently fails with `auth-expired: getNoticeByPage failed: session invalid`; selected collector export cannot complete until operator cookies/storage state are refreshed.

Verification:

```bash
uv run --all-packages python -m campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest ...
AUTHENTICATED_NOTICE_COLLECTION_MODE=selected \
AUTHENTICATED_NOTICE_SELECTED_NOTICES=<notice_id>:<notice_type> \
AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH=<manifest> \
pnpm --dir apps/authenticated-notice-collector bootstrap:export
```
