---
phase: quick-260411-mbr-internal-notice-local-only-chunk-prep-pi
plan: "01"
type: execute
wave: 1
depends_on:
  - 260411-lxl
files_modified:
  - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/260411-mbr-PLAN.md
  - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/pilot_187233_local_chunk_prep.py
  - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-pilot-summary.json
  - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-chunk-catalog.json
  - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-chunk-preview.md
  - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-sample-export/
  - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/260411-mbr-SUMMARY.md
  - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/260411-mbr-VERIFICATION.md
autonomous: true
requirements: []
must_haves:
  truths:
    - This quick task only advances the single promotion candidate `187233 / 中央民族大学采购工作管理办法` through a local-only chunk-prep pilot.
    - The pilot must read only repo-local local-smoke artifacts and must not write Postgres, Qdrant, embeddings, release manifests, aliases, or promotion target collections.
    - The pilot must reuse the existing `internal_notice_chunking_validation` seam rather than inventing a new chunking path.
    - The pilot must emit reviewable artifacts that show actual chunk text, chunk order, and chunk quality signals for `187233`.
  artifacts:
    - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/pilot_187233_local_chunk_prep.py
    - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-pilot-summary.json
    - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-chunk-catalog.json
    - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-chunk-preview.md
    - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-sample-export/
    - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/260411-mbr-SUMMARY.md
    - .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/260411-mbr-VERIFICATION.md
  key_links:
    - `260411-lxl-RESEARCH.md` freezes `187233` as the only safe next pilot candidate and keeps async OCR as the mainline.
    - `packages/ingestion-core/src/campus_ingestion_core/internal_notice_chunking_validation.py` already provides the scan/report/sample-export seam needed for a local-only pilot.
    - `.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/` remains the source of truth for this pilot.
---

<objective>
Execute the next authenticated-notice internal_notice slice as a single-document local-only chunk-prep pilot for `187233 / 中央民族大学采购工作管理办法`.

Purpose: prove that the lone long-term regulation candidate survives the current notice-body chunking path with clean, reviewable chunks before any metadata completion, promotion write, or release-side work.
Output: a runnable pilot script, machine-readable summary, chunk catalog, markdown preview, sample export, and a short acceptance/verification closeout.
</objective>

<context>
@AGENTS.md
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/260411-lxl-RESEARCH.md
@docs/reference/internal-notice-offline-preparation-strategy.md
@docs/reference/internal-notice-offline-preparation-quality-acceptance.md
@configs/ingestion/campus_notices/internal_notice/chunk-profile.json
@packages/ingestion-core/src/campus_ingestion_core/internal_notice_chunking_validation.py
@.planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/cohort_a_local_quality_pilot.py
@.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/documents.json
@.tmp/historical-intake/run14-policy-regulation-expanded/local-smoke/registry/source-truth-inventory.json
</context>

<tasks>
<task type="auto">
  <name>Task 1: Add a single-document local-only pilot harness</name>
  <files>.planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/pilot_187233_local_chunk_prep.py</files>
  <action>Implement a script that loads only `notice:muc_internal_portal:187233` from local-smoke registry/inventory/object-store artifacts, runs `scan_internal_notice_chunking`, builds a validation report, exports sample markdown, and writes a chunk catalog plus markdown preview for every produced chunk.</action>
  <done>The quick-task directory contains a runnable pilot harness for `187233` only.</done>
</task>

<task type="auto">
  <name>Task 2: Run the pilot and freeze artifacts</name>
  <files>.planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-pilot-summary.json .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-chunk-catalog.json .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-chunk-preview.md .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/187233-sample-export/</files>
  <action>Run the pilot harness against the local-smoke artifacts and keep the generated outputs under the quick-task directory.</action>
  <done>The quick-task directory contains reviewable single-document pilot outputs for `187233`.</done>
</task>

<task type="auto">
  <name>Task 3: Write acceptance and verification closeout</name>
  <files>.planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/260411-mbr-SUMMARY.md .planning/quick/260411-mbr-internal-notice-local-only-chunk-prep-pi/260411-mbr-VERIFICATION.md</files>
  <action>Summarize the actual pilot result, the chunk quality signal counts, the number of produced chunks, and the explicit local-only boundary. Verification must confirm no forbidden side effects were performed.</action>
  <done>The quick task ends with a short acceptance note and verification report tied to actual generated artifacts.</done>
</task>
</tasks>
