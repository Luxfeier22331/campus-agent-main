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
- [x] **Phase 2: Selected Notice E2E Smoke Evidence** — selected notice `355867` is replayed through repaired local source-truth, fetch omission, multimodal readiness, and schedule OCR mini-batch evidence.
- [x] **Phase 3: Sample State Machine Audit** — current code replays 338 captured units, produces 60 downstream multimodal candidates, generates 0 fetch requests, and passes state-machine audit with 0 findings.

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

## Phase 3: Sample State Machine Audit

Goal: prove the repaired attachment state machine across the captured notice/file-release replay
cohort without relying on live portal auth.

Deliverables:

- current-code reimport preview from captured runs inventory.
- current-code multimodal readiness preview.
- aggregate fetch request manifest from current source-truth preview.
- state-machine audit report with matrix and findings.
- tests for metadata-only downstream suppression and audit findings.

Evidence:

- `evidence/phase-03-sample-state-machine-audit/reimport-preview-current/reimport-plan.dry-run.json`
- `evidence/phase-03-sample-state-machine-audit/multimodal-readiness-current/multimodal-candidate-inventory.json`
- `evidence/phase-03-sample-state-machine-audit/fetch-request-manifest-current/fetch-request-manifest.from-source-truth-preview.json`
- `evidence/phase-03-sample-state-machine-audit/state-machine-audit-current-with-fetch/state-machine-audit.json`

Result:

- 338 searchable units replayed.
- 58 units still need multimodal after discover-only suppression.
- 60 downstream multimodal candidates generated.
- 0 fetch requests generated because current sampled refs either have bytes or are metadata-only.
- 0 medium/high audit findings.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_reimport_preview \
  tests.ingestion.test_collected_notice_multimodal_readiness \
  tests.ingestion.test_authenticated_notice_state_machine_audit
```
