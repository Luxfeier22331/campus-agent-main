---
phase: quick-260411-ptg-institutional-regulations-cohort-a-target-chunk-acceptance
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py
  - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-rebuilt-source-truth-inventory.json
  - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-candidate-export-rebuilt/promotion-candidate-manifest.json
  - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-candidate-export-rebuilt/candidate-documents.jsonl
  - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-chunk-prep-rebuilt/chunk-prep-manifest.json
  - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-chunk-prep-rebuilt/validation-summary.json
  - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-chunk-prep-rebuilt/document-reports.jsonl
  - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-target-chunk-acceptance-summary.json
  - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-target-chunk-acceptance.md
  - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/260411-ptg-SUMMARY.md
  - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/260411-ptg-VERIFICATION.md
  - docs/plans/post-closeout-follow-up-execution-plan.md
  - .planning/STATE.md
autonomous: true
requirements: []
user_setup: []
must_haves:
  truths:
    - Cohort A target-side acceptance must be measured with reproducible local-only artifacts before any routing or chunking optimization.
    - Rebuilt inventory, candidate export, and target chunk prep must stay separate stages.
    - The resulting truth must capture both promotion admission distribution and target chunk quality observations.
  artifacts:
    - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-target-chunk-acceptance-summary.json
    - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-target-chunk-acceptance.md
    - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/260411-ptg-SUMMARY.md
    - .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/260411-ptg-VERIFICATION.md
  key_links:
    - Azure Databricks retrieval-quality guidance says optimization without a reproducible evaluation system is guesswork.
    - Azure AI Search index projections recommend repeating parent metadata on child chunks.
    - Azure AI Search chunking guidance recommends semantically meaningful chunks with preserved section context.
---

<objective>
Measure Cohort A target-side readiness for `regulations/institutional_regulations` using a local-only batch acceptance harness.

Purpose: turn the remaining generic “target chunk acceptance” work item into concrete evidence showing how many Cohort A notices actually become promotion candidates, and what target-side chunk quality looks like for those candidates.
Output: rebuilt inventory, batch candidate export, target-side chunk-prep artifacts, machine-readable acceptance summary, and updated planning truth.
</objective>

<context>
@AGENTS.md
@.planning/STATE.md
@docs/plans/post-closeout-follow-up-execution-plan.md
@docs/plans/internal-notice-policy-regulation-consumption-implementation.md
@.planning/quick/260410-5yl-internal-notice-policy-regulation-cohort/run14-policy-regulation-cohorts.json
@.planning/quick/260411-ouc-internal-notice-regulation-candidate-loc/260411-ouc-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Build a local-only Cohort A target acceptance harness</name>
  <files>.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py</files>
  <action>Implement a quick-only harness that reads the Cohort A manifest and local-smoke artifacts, rebuilds inventory for the 11 Cohort A notices, exports promotion candidates, runs target chunk prep, and writes machine-readable acceptance outputs without any Postgres/Qdrant/release side effects.</action>
  <done>The harness can be rerun end-to-end from repo-local artifacts alone.</done>
</task>

<task type="auto">
  <name>Task 2: Freeze the actual Cohort A target-side result</name>
  <files>.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-target-chunk-acceptance-summary.json, .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort-a-target-chunk-acceptance.md</files>
  <action>Run the harness and record the true promotion distribution and target-side quality posture, including any manual-review notices and short-fragment observations.</action>
  <done>The artifacts show whether the current bottleneck is routing/admission, chunk quality, or both.</done>
</task>

<task type="auto">
  <name>Task 3: Update planning truth to reflect the narrowed next step</name>
  <files>docs/plans/post-closeout-follow-up-execution-plan.md, .planning/STATE.md, .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/260411-ptg-SUMMARY.md, .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/260411-ptg-VERIFICATION.md</files>
  <action>Record that generic target chunk acceptance is no longer an unknown: the next authenticated-notice work is promotion admission/routing review for the 10 manual-review notices plus short-fragment tuning review for the lone current candidate `187233`.</action>
  <done>STATE and post-closeout planning both point to the same narrowed follow-up.</done>
</task>

</tasks>

<verification>
- [ ] Cohort A rebuilt inventory covers all 11 notices
- [ ] Cohort A candidate export count is machine-checkably recorded
- [ ] Target-side chunk-prep validation summary is generated
- [ ] Manual-review notice distribution is frozen
- [ ] `.planning/STATE.md` and the post-closeout plan reflect the narrowed next task
</verification>

<success_criteria>

- The repo has concrete evidence for Cohort A target-side readiness
- The next authenticated-notice work item is no longer vague
- Future routing or chunking changes can be measured against this batch baseline

</success_criteria>
