---
doc_type: state
status: completed
created: 2026-04-30
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Post-completion hardening complete
**Last Activity:** 2026-05-01
**Last Activity Description:** Added Phase 13 live source-object verification plus mandatory promotion and destructive cleanup media gates.

## Progress

**Phases Complete:** 13
**Current Plan:** N/A

## Completed Tasks

- [x] Created failure taxonomy and sample corpus.
- [x] Froze source/media/fact/target contract.
- [x] Implemented media role classifier.
- [x] Implemented fact readiness builders.
- [x] Refactored `transport_schedule` replay to admit text-complete rows with supplemental pending media.
- [x] Refactored `service_status` replay to admit text-complete current status with supplemental pending media.
- [x] Added regulation fact readiness exposure while preserving owner-text gate.
- [x] Generated replay evidence and closeout summaries.
- [x] Added guard tests for the old pending-media hard gate failure mode.
- [x] Added source retention decision model for notice-level query, service-fact,
  document-owner and capture-only routes.
- [x] Added retention fields to notice source-truth manifest and attachment refs.
- [x] Exposed `source_retention` in collected notice reimport preview and filtered
  metadata-only attachments out of required source object refs.
- [x] Audited 83 legacy `process/no target` units and confirmed current routing keeps
  them metadata-only.
- [x] Added `authenticated_notice_attachment_fetch_request_manifest_v1` builder.
- [x] Changed notice collector default to keep attachments reference-only even when an
  object store is configured.
- [x] Added explicit collector fetch admissions from fetch request manifest rows.
- [x] Aligned collector run ledger required source object verification to required /
  admitted owner bytes; quarantine fetches do not count as required source objects.
- [x] Added typed `last_error_class` propagation for terminal and transient collector
  attachment failures.
- [x] Preserved retryable missing bytes as `attachment_capture_state=transient_failed`
  with `byte_fetch_required=true`.
- [x] Hardened state-machine audit with attachment-ref-scoped candidate binding,
  missing fetch-request findings, source-capture-repair closure checks, and candidate
  `source_object_ref` to attachment bytes matching.
- [x] Normalized legacy `file_release` source refs that already carry bucket /
  object-key / hash source-byte evidence but omitted provider/status into
  `object_store` + `uploaded` before multimodal candidate generation.
- [x] Regenerated collect-to-ingest dry-run preview, media candidate inventory and
  state-machine audit for 338 units / 60 candidates; audit findings are zero.
- [x] Added normalized `notice_media_extraction_attempt_ledger.v1` projection from
  media candidate inventory and attempt plan.
- [x] Added media closeout / target admission state-machine audit covering attempt
  ledger presence, retry budget, closeout output refs, nonterminal target blockers,
  cleanup selection and candidate source-object verification.
- [x] Ran current 60-candidate media closeout audit with attempt ledger, planned
  closeout and source-object verification evidence; audit findings are zero.
- [x] Tightened media closeout audit into strict fail-closed gate: missing required
  gate inputs, orphan attempts, attempt/candidate source ref mismatch, incomplete
  object verification, target manifest unit gaps, cleanup protection gaps and completed
  closeout without attempt provenance now produce medium/high findings.
- [x] Added on-demand closeout batch media gate step before promotion when media gate
  evidence paths are supplied.
- [x] Ran current 60-candidate strict full-gate audit with target admission, cleanup
  protection and complete source-object verification evidence; audit findings are zero.
- [x] Completed collect -> ingest repair loop against official object-integrity and
  explicit state-machine error-handling practices: promotion now requires media gate
  evidence, object verification requires hash and size, completed closeout provenance must
  match a completed attempt, target admission must match candidate target/source, cleanup
  protection uses bucket/key identity, and the worker CLI no longer exposes a partial gate
  escape hatch.
- [x] Added live `notice_media_source_object_verification_report.v1` generation from
  object-store HEAD checksum or controlled GET hash when HEAD lacks checksum.
- [x] Tightened strict media audit so source-object verification must carry
  `check_method=head_checksum|get_hash` and `live_checked_at`.
- [x] Made direct authenticated-notice closeout promotion consume a passed strict media
  gate audit; on-demand promotion now passes the audit artifact into the promoter.
- [x] Made destructive quarantine cleanup consume a passed strict media gate audit and
  reject stale audits whose candidate inventory hash no longer matches cleanup input.
- [x] Added target admission fact-readiness field coverage checks for candidate-mapped
  admission rows.

## Acceptance Evidence

- `evidence/phase-06-evidence-replay-and-acceptance/acceptance-summary.json`
- `evidence/phase-06-evidence-replay-and-acceptance/transport-schedule-acceptance.json`
- `evidence/phase-06-evidence-replay-and-acceptance/service-status-acceptance.json`
- `evidence/phase-06-evidence-replay-and-acceptance/regulation-acceptance.json`
- `evidence/phase-08-retention-preview-audit/preview-process-no-target-audit.json`
- `phases/phase-09-live-collector-fetch-admission/SUMMARY.md`
- `evidence/post-completion-collect-ingest-repair-loop/round-3-audit-summary.json`
- `/tmp/campus-agent-state-machine-loop/phase10/audit-with-object-verification/media-closeout-state-machine-audit.json`
- `/tmp/campus-agent-state-machine-loop/phase11/audit-strict/media-closeout-state-machine-audit.json`
- `/tmp/campus-agent-state-machine-loop/phase12/audit-strict/media-closeout-state-machine-audit.json`
- Local verification 2026-05-01:
  `uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_media_closeout_state_machine_audit tests.ingestion.test_authenticated_notice_attachment_key_cleanup tests.ingestion.authenticated_notice_closeout_async_verification_and_promotion_suite tests.ingestion.authenticated_notice_closeout_async_worker_stage_suite tests.ingestion.test_on_demand_batch_runner tests.ingestion.test_authenticated_notice_closeout_worker`

## Known Non-Overlap

- No scheduler, auth renewal, collector provider or public serving surface was changed.
- No DB, object-store, release or current truth writes were performed.
- Collector live execution now requires upstream operator/scheduler wiring to set
  `AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH` when attachment bytes are admitted.

## Blockers

No workstream blockers remain.

## Resume Notes

Only reopen if target replay regresses to whole-notice media gating, source retention
regresses to attachment-type-first byte retention, collector default attachment capture
regresses to eager bytes download, required/admitted owner bytes stop failing closed, new
target fact groups are admitted, attachment-level candidate binding regresses to unit-level
fallback, retryable attachment failures stop carrying typed state, or OCR/owner-text output
schemas change. Also reopen if object-backed `file_release` source refs with bucket /
object-key / hash regress to `source_capture_repair` solely because provider/status is
missing from a historical preview artifact. Reopen if a target-blocking media candidate
lacks an attempt ledger row, a retryable failure lacks retry budget, a completed closeout
lacks output refs or attempt provenance, target admission becomes ready while target-blocking
media is nonterminal, target admission manifest omits a media candidate unit, cleanup
selects or fails to protect active blocking quarantine bytes, object verification does not
match bucket/key/hash/size/storage provider with live check method and timestamp, direct
promotion can pass without strict full-gate evidence, or destructive cleanup can delete
without a passed non-stale media gate audit.
