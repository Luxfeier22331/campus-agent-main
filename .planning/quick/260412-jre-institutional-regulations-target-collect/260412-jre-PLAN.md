---
phase: quick-260412-jre-institutional-regulations-target-collect
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/quick/260412-jre-institutional-regulations-target-collect/260412-jre-PLAN.md
  - .planning/quick/260412-jre-institutional-regulations-target-collect/rerun-output/
  - .planning/quick/260412-jre-institutional-regulations-target-collect/260412-jre-SUMMARY.md
  - .planning/quick/260412-jre-institutional-regulations-target-collect/260412-jre-VERIFICATION.md
  - docs/plans/archive/historical/post-closeout-follow-up-execution-plan.md
  - .planning/STATE.md
autonomous: true
requirements: []
must_haves:
  truths:
    - "This quick task is local-only and must not require portal auth."
    - "`institutional_regulations` target chunk-prep acceptance must stop before embeddings, Qdrant writes, release, or alias publish."
    - "If the current rerun result differs from the old `1 promote / 10 manual review` snapshot, the refreshed machine-readable artifacts and planning docs must say so explicitly."
    - "Any follow-up recommendation after the rerun must be based on the refreshed acceptance result, not the stale Cohort A summary."
  artifacts:
    - .planning/quick/260412-jre-institutional-regulations-target-collect/rerun-output/cohort-a-target-chunk-acceptance-summary.json
    - .planning/quick/260412-jre-institutional-regulations-target-collect/rerun-output/cohort-a-target-chunk-acceptance.md
    - .planning/quick/260412-jre-institutional-regulations-target-collect/260412-jre-SUMMARY.md
    - .planning/quick/260412-jre-institutional-regulations-target-collect/260412-jre-VERIFICATION.md
  key_links:
    - "`docs/plans/archive/historical/post-closeout-follow-up-execution-plan.md` contained stale Cohort A counts and needed to be refreshed from a new rerun."
    - "Use `.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py` as the existing harness, but write fresh evidence into the new quick-task directory."
    - "Do not reopen auth-dependent collector work or general OCR phase work in this quick task."
---

<objective>
Refresh the local-only `institutional_regulations` target chunk-preparation acceptance truth on the current codebase and update planning to match the refreshed result.

Purpose: replace stale Cohort A counts with current evidence, then narrow the next offline regulation action based on the refreshed acceptance outcome.
</objective>

<tasks>
<task type="auto">
  <name>Task 1: Produce fresh local-only Cohort A acceptance artifacts</name>
  <files>.planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py .planning/quick/260412-jre-institutional-regulations-target-collect/rerun-output/</files>
  <action>Run the existing Cohort A target chunk acceptance harness against the current codebase, but write artifacts into this quick-task directory so the refreshed result is isolated from the older quick task.</action>
  <verify>
    <automated>uv run --all-packages python .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py --output-dir .planning/quick/260412-jre-institutional-regulations-target-collect/rerun-output</automated>
  </verify>
  <done>Fresh machine-readable and operator-readable acceptance artifacts exist under the new quick-task directory.</done>
</task>

<task type="auto">
  <name>Task 2: Refresh planning truth from the new acceptance result</name>
  <files>docs/plans/archive/historical/post-closeout-follow-up-execution-plan.md .planning/STATE.md</files>
  <action>Read the refreshed summary JSON and update the planning truth so the repo no longer claims the older `1 promote / 10 manual review` Cohort A posture if the rerun result has changed. The updated next action must reflect the rerun result.</action>
  <verify>
    <automated>jq '{promotion_candidate_count, promotion_manual_review_count, prepared_candidate_count, quality_posture, short_body_chunk_count}' .planning/quick/260412-jre-institutional-regulations-target-collect/rerun-output/cohort-a-target-chunk-acceptance-summary.json</automated>
  </verify>
  <done>The follow-up plan and state summary reflect the rerun result instead of the stale historical snapshot.</done>
</task>

<task type="auto">
  <name>Task 3: Record the quick-task outcome and verification</name>
  <files>.planning/quick/260412-jre-institutional-regulations-target-collect/260412-jre-SUMMARY.md .planning/quick/260412-jre-institutional-regulations-target-collect/260412-jre-VERIFICATION.md .planning/STATE.md</files>
  <action>Write a concise quick-task summary and verification report, and append the task to the STATE quick-task table as `worktree` because the repository already contains unrelated dirty changes.</action>
  <verify>
    <automated>ls -1 .planning/quick/260412-jre-institutional-regulations-target-collect</automated>
  </verify>
  <done>The quick-task directory contains plan, summary, verification, and rerun-output; STATE records the task.</done>
</task>
</tasks>
