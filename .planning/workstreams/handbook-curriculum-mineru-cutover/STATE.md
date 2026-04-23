---
workstream: handbook-curriculum-mineru-cutover
created: 2026-04-23
updated: 2026-04-23
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 2
**Current Phase Name:** Source Truth Hard Gate And Runtime Alignment
**Current Plan:** workstream roadmap drives execution directly; current phase has no separate PLAN file
**Total Phases:** 5
**Total Plans in Phase:** 0
**Progress:** 2/5 phases complete
**Last Activity:** 2026-04-23
**Last Activity Description:** Added handbook source-truth hard gate, aligned source-truth quality-gate tests to MinerU, and started updating planning/runbook/reference truth so the cutover is no longer hidden under unrelated workstreams.

## Progress

- completed `Phase 1` truth:
  - `student_rules` 与 `curriculum_plan`
    runtime profile 已显式指向 `mineru_api + vlm + mineru-vlm-adapted-v2`
  - cutover 目标固定为覆盖现有 Paddle 派生 canonical truth，
    不保留 forward dual-track
  - rollback 边界固定为 source bucket snapshot、
    current release manifest 与 alias pointer

- completed `Phase 2` truth:
  - handbook source-truth 现在拥有 dedicated fail-close validator
  - quality-gate tests for handbook/curriculum 已切到 MinerU labels
  - 前向 runbook/reference/planning truth 正在清理 Paddle 默认叙述

## Session Continuity

**Stopped At:** code-level hard gate 已经落地；下一次恢复应直接进入 `Phase 3` shadow rebuild、docs refresh 和 release dry run evidence。
**Resume File:** docs/runbooks/student-handbook-hybrid-rebuild-checklist.md
