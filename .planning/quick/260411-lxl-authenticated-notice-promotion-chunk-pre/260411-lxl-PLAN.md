---
phase: quick-260411-lxl-authenticated-notice-promotion-chunk-pre
plan: "01"
type: research
wave: 1
depends_on: []
files_modified:
  - .planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/260411-lxl-RESEARCH.md
  - .planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/manual-review-taxonomy.json
  - .planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/260411-lxl-SUMMARY.md
  - .planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/260411-lxl-VERIFICATION.md
autonomous: true
requirements: []
must_haves:
  truths:
    - Promotion manifest v5 remains the current decision input: only `187233` is a long-term regulation candidate; wrapper holds and manual-review rows must not be silently mixed back into the candidate set.
    - The next executable slice is a local-only single-document chunk-prep pilot on `187233`, not a batch-wide preparation run.
    - OCR mainline stays `paddleocr_async_jobs`; sync layout-parsing service remains diagnostic only.
    - Manual-review rows are frozen into explicit sub-taxonomy instead of a generic catch-all bucket.
  artifacts:
    - .planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/260411-lxl-RESEARCH.md
    - .planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/manual-review-taxonomy.json
    - .planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/260411-lxl-SUMMARY.md
    - .planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/260411-lxl-VERIFICATION.md
  key_links:
    - `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md` fixes `internal_notice` as source-triage only and forbids wrapper notices from directly becoming regulation rows.
    - `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py` currently defaults OCR to `paddleocr_async_jobs`.
    - `configs/ingestion/campus_notices/internal_notice/chunk-profile.json` already defines lane-local chunk budgets, so the next pilot should exercise `notice_body` lane defaults rather than invent a new global budget.
---

<objective>
Freeze the research-backed next step after authenticated-notice promotion v5 converged.

Purpose: stop the team from over-expanding into full-batch chunking or premature promotion writes, while keeping the only plausible long-term regulation candidate moving through a bounded local pilot.
Output: one research note, one structured manual-review taxonomy artifact, and one concise summary that locks the next safe execution slice.
</objective>

<context>
@AGENTS.md
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@docs/architecture/domains/authenticated-notice/architecture.md
@docs/data/authenticated-notice-source-truth-schema.md
@docs/reference/internal-notice-offline-preparation-strategy.md
@docs/reference/internal-notice-offline-preparation-quality-acceptance.md
@docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md
@.planning/workstreams/authenticated-notice-regulation-consumption/README.md
@configs/ingestion/campus_notices/internal_notice/chunk-profile.json
@configs/ingestion/campus_notices/internal_notice/README.md
@packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py
@.tmp/internal-notice-promotion-manifests/run14-policy-regulation-expanded-v5-local-smoke/promotion-manifest.json
@.tmp/internal-notice-promotion-manifests/run14-policy-regulation-expanded-v5-local-smoke/document-reports.jsonl
</context>

<tasks>
<task type="auto">
  <name>Task 1: Write the research note</name>
  <files>.planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/260411-lxl-RESEARCH.md</files>
  <action>Summarize repo current truth, official external references, and the practical implication for the next authenticated-notice execution slice. The note must explicitly confirm that only `187233` advances to a bounded chunk-prep pilot, that wrapper holds stay in `internal_notice`, and that manual rows stay parked.</action>
  <done>The quick-task directory contains a self-contained research note with repo facts, official links, and a clear next-slice recommendation.</done>
</task>

<task type="auto">
  <name>Task 2: Freeze a structured manual-review taxonomy</name>
  <files>.planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/manual-review-taxonomy.json</files>
  <action>Convert the 10 `manual_review_required` notices into explicit subcategories that explain why they are blocked from `regulations/institutional_regulations` today and what future collection family they might belong to if scope expands later.</action>
  <done>The quick-task directory contains a machine-readable manual-review taxonomy with exact notice ids and forward hints.</done>
</task>

<task type="auto">
  <name>Task 3: Freeze the next execution slice summary</name>
  <files>.planning/quick/260411-lxl-authenticated-notice-promotion-chunk-pre/260411-lxl-SUMMARY.md</files>
  <action>Write a concise summary that an operator can use as the next-step contract: what to run next, what not to run yet, and which ids belong to candidate/hold/manual buckets.</action>
  <done>The quick-task directory contains a concise next-step summary that prevents accidental batch-wide promotion or chunk-prep expansion.</done>
</task>
</tasks>

<verification>
- [ ] research note includes both repo-local truth and official external links
- [ ] manual-review taxonomy accounts for all 10 current manual ids
- [ ] summary states `187233` as the only next pilot candidate
- [ ] summary explicitly forbids Postgres/Qdrant/embedding/release side effects for the next slice
</verification>

<success_criteria>

- the next authenticated-notice action is no longer ambiguous
- the team has a repo-tracked reason for keeping async OCR as the canonical mainline
- seasonal/admissions documents are clearly parked outside the current regulation collection scope

</success_criteria>
