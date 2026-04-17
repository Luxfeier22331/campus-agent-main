---
phase: quick-260411-pbp-historical-donor-local-smoke-routing-mis
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py
  - tests/ingestion/test_authenticated_notice_import.py
  - docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md
  - docs/reference/authenticated-notice-historical-donor-intake-evidence.md
  - docs/plans/post-closeout-follow-up-execution-plan.md
  - .planning/STATE.md
  - .planning/quick/260411-pbp-historical-donor-local-smoke-routing-mis/260411-pbp-SUMMARY.md
  - .planning/quick/260411-pbp-historical-donor-local-smoke-routing-mis/260411-pbp-VERIFICATION.md
autonomous: true
requirements: []
user_setup: []
must_haves:
  truths:
    - Attachment-backed historical donor import/local smoke must fail closed when normalized manifest says `blob_store_reference` but `attachment_blob_root` is missing.
    - Local smoke inventory remains the attachment-routing truth; donor byte-aware analysis is only diagnostic cross-check evidence.
    - Body-only historical donor batches remain importable without `attachment_blob_root`.
  artifacts:
    - .planning/quick/260411-pbp-historical-donor-local-smoke-routing-mis/260411-pbp-SUMMARY.md
    - .planning/quick/260411-pbp-historical-donor-local-smoke-routing-mis/260411-pbp-VERIFICATION.md
  key_links:
    - `import_authenticated_notice_export` is the correct contract boundary for this cleanup because that is where source-truth persistence and local-smoke truth begin.
    - Databricks expectations documentation describes `FAIL UPDATE` as blocking the update until manual intervention when invalid input is detected.
    - Amazon S3 `HeadObject` is the canonical object-existence/metadata preflight primitive before downstream processing depends on object bytes.
---

<objective>
Close the historical donor local-smoke routing mismatch as a donor-import seam cleanup.

Purpose: remove the remaining dual-truth mode where local smoke/import could succeed without attachment bytes while routing truth was inferred elsewhere.
Output: core import fast-fail guardrail, targeted tests, and aligned planning/runbook/reference truth.
</objective>

<context>
@AGENTS.md
@.planning/STATE.md
@docs/plans/post-closeout-follow-up-execution-plan.md
@docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md
@docs/reference/authenticated-notice-historical-donor-intake-evidence.md
@packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py
@tests/ingestion/test_authenticated_notice_import.py
</context>

<tasks>

<task type="auto">
  <name>Task 1: Freeze the import precondition in tests</name>
  <files>tests/ingestion/test_authenticated_notice_import.py</files>
  <action>Add contract tests for three cases: blob-store-reference manifest plus object-backed attachments without `attachment_blob_root` must fail; the same batch with `attachment_blob_root` stays green; body-only batches remain allowed.</action>
  <done>Tests express the desired contract before the implementation is changed.</done>
</task>

<task type="auto">
  <name>Task 2: Fail closed in the core import boundary</name>
  <files>packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py</files>
  <action>Before persistence begins, inspect the normalized manifest and selected bundle. If `collector.attachment_storage_mode=blob_store_reference` and the bundle contains object-backed attachments, require `request.attachment_blob_root`; otherwise raise an explicit import-preflight error.</action>
  <done>The importer can no longer emit source-truth artifacts or local-smoke outputs for attachment-backed historical batches when the blob-root dependency is missing.</done>
</task>

<task type="auto">
  <name>Task 3: Align repo truth and verification evidence</name>
  <files>.planning/STATE.md, docs/plans/post-closeout-follow-up-execution-plan.md, docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md, docs/reference/authenticated-notice-historical-donor-intake-evidence.md, .planning/quick/260411-pbp-historical-donor-local-smoke-routing-mis/260411-pbp-SUMMARY.md, .planning/quick/260411-pbp-historical-donor-local-smoke-routing-mis/260411-pbp-VERIFICATION.md</files>
  <action>Record that this cleanup is complete, preserve the single-source-of-truth posture for local smoke inventory, and capture the official fail-fast/object-existence rationale plus targeted verification results.</action>
  <done>The remaining authenticated-notice follow-up list no longer includes this mismatch, and the quick-task artifacts explain both the local proof and the external rationale.</done>
</task>

</tasks>

<verification>
- [ ] Attachment-backed normalized donor batch without `attachment_blob_root` now fails
- [ ] Body-only normalized donor batch still imports successfully
- [ ] Worker CLI typed request tests remain green
- [ ] Runbook and evidence docs describe the fast-fail contract explicitly
- [ ] `.planning/STATE.md` no longer lists this mismatch as remaining follow-up
</verification>

<success_criteria>

- The historical donor import seam no longer has dual truth
- Operators have one routing truth source: local smoke inventory
- Missing blob-root dependencies fail before persistence instead of after-the-fact interpretation

</success_criteria>
