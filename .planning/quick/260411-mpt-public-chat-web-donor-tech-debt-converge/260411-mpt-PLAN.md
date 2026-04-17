---
phase: quick-260411-mpt-public-chat-web-donor-tech-debt-converge
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/quick/260411-mpt-public-chat-web-donor-tech-debt-converge/260411-mpt-PLAN.md
  - .planning/quick/260411-mpt-public-chat-web-donor-tech-debt-converge/260411-mpt-SUMMARY.md
  - .planning/quick/260411-mpt-public-chat-web-donor-tech-debt-converge/260411-mpt-VERIFICATION.md
  - docs/plans/public-chat-web-vendor-tech-debt-convergence.md
  - apps/public-chat-web/README.md
  - docs/reference/public-chat-web-donor-parity-review-checklist.md
autonomous: true
requirements: []
must_haves:
  truths:
    - This quick task closes `public-chat-web` donor tech-debt convergence Wave 5, not a new parity redesign.
    - Closeout must use the current repo-owned local live-smoke topology: `public-chat-web dev:live-smoke` plus local `supervisor-api`.
    - Closeout evidence must stay redacted and focus on runtime connectivity / shell behavior, not answer-quality scoring.
    - The current Wave 4 donor diff classification truth must remain green while the new smoke evidence is captured.
  artifacts:
    - .planning/quick/260411-mpt-public-chat-web-donor-tech-debt-converge/260411-mpt-SUMMARY.md
    - .planning/quick/260411-mpt-public-chat-web-donor-tech-debt-converge/260411-mpt-VERIFICATION.md
    - .tmp/local-smoke/public-chat-wave5-closeout-*/
  key_links:
    - `docs/plans/public-chat-web-vendor-tech-debt-convergence.md` defines Wave 5 as verification and closeout.
    - `docs/runbooks/forward-worker-surface-smoke-runbook.md` fixes `pnpm --dir apps/public-chat-web dev:live-smoke` as the canonical local browser smoke entry.
    - `docs/runbooks/public-chat-staging-smoke-artifact-template.md` fixes the redaction contract and artifact shape for browser smoke evidence.
---

<objective>
Execute the next `public-chat-web` slice as Wave 5 verification and closeout for donor tech-debt convergence.

Purpose: freeze a fresh local live-smoke evidence pack on top of the current Wave 4 donor-diff classification truth, then update plan/readme/reference docs so the next step is no longer "verification closeout pending" but post-closeout follow-up only.
Output: a quick-task summary/verification pair, a redacted local smoke artifact directory, and repo docs updated to record Wave 5 closeout.
</objective>

<context>
@AGENTS.md
@.planning/PROJECT.md
@.planning/STATE.md
@docs/plans/public-chat-web-vendor-tech-debt-convergence.md
@apps/public-chat-web/README.md
@docs/runbooks/forward-worker-surface-smoke-runbook.md
@docs/runbooks/public-chat-staging-smoke-artifact-template.md
@docs/reference/public-chat-web-donor-diff-classification.md
@docs/reference/public-chat-web-donor-parity-review-checklist.md
</context>

<tasks>
<task type="auto">
  <name>Task 1: Confirm closeout lane and freeze quick-task evidence boundary</name>
  <files>.planning/quick/260411-mpt-public-chat-web-donor-tech-debt-converge/260411-mpt-PLAN.md .planning/quick/260411-mpt-public-chat-web-donor-tech-debt-converge/260411-mpt-SUMMARY.md .planning/quick/260411-mpt-public-chat-web-donor-tech-debt-converge/260411-mpt-VERIFICATION.md</files>
  <action>Record Wave 5 as a verification/closeout-only quick task, note the local live-smoke topology, and keep the evidence redacted.</action>
  <done>The quick-task directory states the exact Wave 5 boundary and expected artifacts.</done>
</task>

<task type="auto">
  <name>Task 2: Run fresh local verification and browser smoke</name>
  <files>.tmp/local-smoke/public-chat-wave5-closeout-*/</files>
  <action>Provision the local smoke identity, start local `supervisor-api`, start `public-chat-web dev:live-smoke`, execute a real browser smoke through `/login` and `/chat`, and save a redacted evidence pack with screenshots plus a short runtime/network summary.</action>
  <done>A fresh local smoke directory exists and proves login, empty state, first send, typed outcome, and history persistence without storing raw secrets.</done>
</task>

<task type="auto">
  <name>Task 3: Close docs against the new evidence</name>
  <files>docs/plans/public-chat-web-vendor-tech-debt-convergence.md apps/public-chat-web/README.md docs/reference/public-chat-web-donor-parity-review-checklist.md</files>
  <action>Update the plan/readme/checklist so Wave 5 is recorded as closed with the new local evidence and the app no longer advertises verification closeout as pending.</action>
  <done>Repo docs point at the fresh Wave 5 local evidence and describe the post-closeout state correctly.</done>
</task>
</tasks>
