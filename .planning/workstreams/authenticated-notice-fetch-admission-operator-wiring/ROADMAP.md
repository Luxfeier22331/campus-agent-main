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
- [x] **Phase 4: Media Extraction Semantics Repair** — current readiness output now uses OCR/text-extraction-first media extraction semantics while preserving legacy multimodal filenames for compatibility.
- [x] **Phase 5: Media Extraction Closeout Lane** — schedule OCR and owner-text execution outputs now emit canonical closeout result manifests, and a dry-run closeout CLI updates media extraction candidate inventory terminal states.
- [x] **Phase 6: Offline Closeout Verification** — selected notice `355867` proves readiness -> OCR post-run closeout -> cleanup gate behavior, including low-confidence non-terminal preservation and manual terminal release.

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

## Phase 5: Media Extraction Closeout Lane

Goal: close the gap between media extraction execution outputs and canonical
readiness state, so cleanup gates and downstream replay do not remain stuck on
`pending` after OCR/text extraction has produced terminal evidence.

Deliverables:

- canonical `notice_media_extraction_closeout_result_manifest.v1` result manifest.
- dry-run closeout merge that rewrites `notice_media_extraction_candidate_inventory.v1`
  status / `media_text_status` / `target_blocking` from result manifests.
- schedule image OCR post-run preview emits media extraction closeout result manifest.
- regulation owner text execution report emits media extraction closeout result manifest.
- ingestion-worker CLI:
  `campus-ingestion-preview-collected-notice-media-extraction-closeout`.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_media_extraction_closeout \
  tests.ingestion.test_collected_notice_schedule_image_ocr_mini_batch \
  tests.ingestion.test_preview_schedule_image_ocr_mini_batch_worker \
  tests.ingestion.test_collected_notice_regulation_owner_text_execution
```

## Phase 6: Offline Closeout Verification

Goal: prove the Phase 5 closeout lane and quarantine cleanup gate against the
real selected notice `355867` without depending on refreshed live portal auth.

Deliverables:

- current-code media extraction readiness evidence for selected notice `355867`.
- schedule OCR post-run preview against captured OCR outputs.
- closeout merge evidence proving terminal candidates clear `target_blocking`.
- quarantine cleanup dry-run evidence for pending, OCR post-run closeout, and
  manual terminal closeout states.
- phase summary documenting the low-confidence image behavior explicitly.

Result:

- readiness: 3 `schedule_image_ocr` candidates, all `target_blocking=true`.
- OCR post-run: 32 extracted transport schedule rows; 2 candidates completed, 1
  low-confidence image remained non-terminal and blocking.
- cleanup pending state: `blocked_by_media_extraction_count=3`,
  `dry_run_count=0`.
- cleanup OCR post-run closeout state: `blocked_by_media_extraction_count=1`,
  `dry_run_count=2`.
- cleanup manual terminal state: `blocked_by_media_extraction_count=0`,
  `dry_run_count=3`.

Evidence:

- `evidence/phase-06-offline-closeout-verification/current-readiness/media-extraction-candidate-inventory.json`
- `evidence/phase-06-offline-closeout-verification/schedule-ocr-post-run-preview/media-extraction-closeout-result-manifest.json`
- `evidence/phase-06-offline-closeout-verification/post-run-closeout/media-extraction-closeout-report.json`
- `evidence/phase-06-offline-closeout-verification/manual-terminal-closeout/media-extraction-closeout-report.json`
- `evidence/phase-06-offline-closeout-verification/cleanup-pending/quarantine-summary.json`
- `evidence/phase-06-offline-closeout-verification/cleanup-post-run-closeout/quarantine-summary.json`
- `evidence/phase-06-offline-closeout-verification/cleanup-manual-terminal-closeout/quarantine-summary.json`

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_media_extraction_closeout \
  tests.ingestion.test_authenticated_notice_attachment_key_cleanup \
  tests.ingestion.test_collected_notice_schedule_image_ocr_mini_batch \
  tests.ingestion.test_preview_schedule_image_ocr_mini_batch_worker -q
```

## Phase 4: Media Extraction Semantics Repair

Goal: remove the misleading default `multimodal` routing for captured PDFs and
media-backed facts without breaking existing downstream preview filenames.

Deliverables:

- canonical `notice_media_extraction_candidate_inventory.v1` readiness payload.
- compatibility `multimodal-candidate-inventory.json` output that carries the
  same canonical payload plus `legacy_schema_version`.
- OCR/text-extraction-first processing families:
  `released_file_text_extraction`, `pdf_ocr_text_extraction`,
  `office_text_extraction`, and `schedule_image_ocr`.
- candidate-level `media_role` and `target_blocking` for target-specific fact gates.
- quarantine cleanup gate that preserves expired object-backed bytes while
  target-blocking media extraction candidates are still non-terminal.
- state-machine audit guard for PDF/Office candidates incorrectly routed to
  `internal_notice_multimodal` or `multimodal_fallback`.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_reimport_preview \
  tests.ingestion.test_collected_notice_multimodal_readiness \
  tests.ingestion.test_preview_collected_notice_multimodal_readiness_worker \
  tests.ingestion.test_collected_notice_fact_readiness \
  tests.ingestion.test_collected_notice_regulation_owner_text_recovery \
  tests.ingestion.test_collected_notice_regulation_owner_text_execution \
  tests.ingestion.test_collected_notice_regulation_admission \
  tests.ingestion.test_collected_notice_service_status_downstream_replay \
  tests.ingestion.test_authenticated_notice_state_machine_audit
```
