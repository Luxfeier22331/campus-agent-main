---
doc_type: index
status: completed
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Workstream: Institutional Rules Retrieval Quality Baseline

这是 `institutional-rules-retrieval-quality-baseline` 的 native workstream 入口。

本线覆盖已进入默认 consumption truth 的校级 `regulations/institutional_rules`，目标是把它们从
“已进入 RAG release/admission”推进到“有 golden retrieval qrels、hard-negative no-hit guard
和 answer source-identity contract 的质量基线”。

## Current Status

- status: `completed`
- current phase: `Phase 00 golden dataset v1 completed; 42-document fixture refresh applied`
- current focus: 42 条校级 institutional rules 已有 89-case golden retrieval qrels、
  42-case answer quality contract；其中原 30 条已有 live retrieval no-hit policy 修复证据，
  本轮 12 条 selected school-level re-admission 只更新 repo-tracked fixture truth
- non-goal: 不把院级 `scoped_rules` 纳入默认文档站或 RAG consumption

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Phase Plans

- `./phases/phase-00-golden-dataset-v1/PLAN.md`
- `./phases/phase-00-golden-dataset-v1/SUMMARY.md`

## Evidence

本线 evidence 放在 gitignored `./evidence/phase-00-golden-dataset-v1/`：

- `golden-oracle-summary.json`
- `golden-live-summary.after-policy-fix.json`
- `golden-live-run.after-policy-fix.json`
- `answer-quality-contract.json`
- `answer-quality-contract/profile-report.json`
