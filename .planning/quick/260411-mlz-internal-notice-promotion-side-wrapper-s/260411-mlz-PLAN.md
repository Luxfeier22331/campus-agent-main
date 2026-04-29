---
phase: quick-260411-mlz-internal-notice-promotion-side-wrapper-s
plan: "01"
type: execute
wave: 1
depends_on:
  - 260411-lxl
  - 260411-mbr
files_modified:
  - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/260411-mlz-PLAN.md
  - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/pilot_187233_wrapper_cleanup.py
  - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/187233-wrapper-cleanup-preview.json
  - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/187233-cleaned-body.md
  - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/187233-promotion-report.json
  - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/260411-mlz-SUMMARY.md
  - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/260411-mlz-VERIFICATION.md
autonomous: true
requirements: []
must_haves:
  truths:
    - Promotion-side wrapper stripping must be implemented as a promotion helper, not by rewriting `internal_notice` source-triage canonical markdown.
    - The helper must preserve `中央民族大学采购工作管理办法` as a candidate while making wrapper removal explicit and reviewable.
    - Summary notices such as `中央民族大学学生申诉管理办法` must remain non-promotable after cleanup because they still lack standalone regulation structure.
    - All artifacts remain local-only and read-only with no Postgres/Qdrant/release side effects.
  artifacts:
    - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/pilot_187233_wrapper_cleanup.py
    - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/187233-wrapper-cleanup-preview.json
    - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/187233-cleaned-body.md
    - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/187233-promotion-report.json
    - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/260411-mlz-SUMMARY.md
    - .planning/quick/260411-mlz-internal-notice-promotion-side-wrapper-s/260411-mlz-VERIFICATION.md
  key_links:
    - `260411-lxl-RESEARCH.md` already freezes the official rationale for structure-aware chunking and explicit manual-review gating.
    - `260411-mbr-SUMMARY.md` already proved `187233` passes local chunk-prep but still contains wrapper semantics in raw chunks.
    - `internal_notice_regulation_promotion.py` is the correct ownership boundary for promotion-side cleanup helpers.
---

<objective>
Implement and validate promotion-side wrapper stripping for `中央民族大学采购工作管理办法` without mutating `internal_notice` source-triage truth.

Purpose: make wrapper removal explicit, tested, and reviewable before any future regulation-body write path exists.
Output: helper-backed cleanup preview artifacts, updated promotion report evidence, and a short closeout.
</objective>
