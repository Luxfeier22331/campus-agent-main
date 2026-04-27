---
doc_type: roadmap
status: active
created: 2026-04-28
updated: 2026-04-28
---

# Roadmap: Official Web University-Level Collection Dev Closeout

## Overview

本 workstream 固定校级 official web 采集 dev closeout 的执行顺序。它不是院级 rollout，
也不是 `fresh_news` / `news_archive` opening。

## Phases

## Phase 0: Boundary And Baseline

**Status:** pending

**Goal:** 固定本 workstream 的校级采集范围、上游 evidence、non-goals 和执行入口。

**Plan:** `./phases/phase-0-boundary-and-baseline/PLAN.md`

## Phase 1: Lane Scope And Command Contract

**Status:** pending

**Goal:** 明确 `university-core-hot` 与 `university-core-baseline` 的 lane 语义、host 范围、
命令合同和 artifact 命名。

**Plan:** `./phases/phase-1-lane-scope-and-command-contract/PLAN.md`

## Phase 2: Dev Runner

**Status:** pending

**Goal:** 补齐按 `lane_id` 运行校级采集的 dev runner 或 documented wrapper。

**Plan:** `./phases/phase-2-dev-runner/PLAN.md`

## Phase 3: Preflight

**Status:** pending

**Goal:** 补齐校级采集专属 preflight，确保配置、lane、host、输出目录和 artifact-only
边界可验证。

**Plan:** `./phases/phase-3-preflight/PLAN.md`

## Phase 4: Fresh Baseline Evidence

**Status:** pending

**Goal:** 跑 fresh `university-core-baseline`，产出从 crawl 到 chunk audit 的完整本地证据。

**Plan:** `./phases/phase-4-fresh-baseline-evidence/PLAN.md`

## Phase 5: Repeated-Run Idempotency

**Status:** pending

**Goal:** 连续两次运行同一校级 lane，验证 projection / artifact side effects 可重复且不会制造重复。

**Plan:** `./phases/phase-5-repeated-run-idempotency/PLAN.md`

## Phase 6: Retention And Alerts

**Status:** pending

**Goal:** 补齐本地 report retention 与 alert summary 规则。

**Plan:** `./phases/phase-6-retention-and-alerts/PLAN.md`

## Phase 7: Import/Promote Handoff Dry-Run

**Status:** pending

**Goal:** 验证 projection output 满足 import/promote handoff 前置条件，但不执行实际 promotion。

**Plan:** `./phases/phase-7-import-promote-handoff-dry-run/PLAN.md`

## Close Rule

本 workstream 可关闭的条件：

- Phase 0-7 全部完成；
- `STATE.md` 记录所有最新 evidence 路径；
- `university-core-baseline` fresh evidence 和 repeated-run evidence 均通过；
- retention / alert 规则可重复执行；
- import/promote handoff dry-run 通过，且明确没有实际 promotion；
- 不改变 `fresh_news` / `news_archive` serving surface，不开启院级全量。
