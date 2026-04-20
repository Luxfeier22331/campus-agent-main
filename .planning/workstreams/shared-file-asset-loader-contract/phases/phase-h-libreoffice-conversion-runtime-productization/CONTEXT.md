---
phase: "H"
name: "LibreOffice Conversion Runtime Productization"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase H Context

## Goal

在不改写 shared file asset contract、source-truth unit 和既有 OCR lane 的前提下，把 legacy Office family（`.doc/.xls`）的 canonical runtime 从 worker-direct `soffice --convert-to` 过渡实现收口到 repo 已冻结的 `internal self-hosted conversion service` 形态。

## Current Truth

- `Phase A-G` 已经完成 shared contract、family backend selection、`authenticated_notice` migration、cross-scope hardening 与 OCR lane-first provider contract realignment。
- legacy Office family 已经进入 shared substrate，但当前真正执行转换的代码仍在 `packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py` 中直接通过 `shutil.which("soffice")` + `subprocess.run([... --convert-to ...])` 调起本机 LibreOffice CLI。
- 架构文档已经冻结：
  - production posture 必须是 `internal self-hosted conversion service`
  - 首个推荐实现是 `JODConverter + LibreOffice`
  - 固定禁止把“业务 worker 每次直接拉起 `soffice --convert-to`”作为长期生产形态
- 当前这台环境也尚未安装 `soffice`，进一步暴露出 repo 还没有为 LibreOffice-family conversion 落下统一的 env / deploy / health / operator truth。

## Why This Phase Exists

`Phase D` 把 legacy Office family 接进了 shared substrate，但那解决的是 contract 和 source-path owner 问题，不是长期 runtime 形态问题。

如果现在直接把 workstream 关掉，会留下一个结构性缺口：

- architecture 说“self-hosted conversion service”
- code 还在“worker shell out to local soffice”
- operator truth 里没有 deployment、healthcheck、service env、runbook

这会让 legacy Office family 继续停留在“代码里能调用，但 runtime 没真正被产品化”的状态。

## Locked Decisions

### Runtime Boundary

- canonical owner 仍然是 `packages/ingestion-core` 的 shared conversion contract。
- office process lifecycle 不再由业务 worker 直接持有。
- 运行时形态固定为 repo-owned self-hosted conversion service，而不是外部 conversion SaaS。

### First Implementation

- 首个自部署实现固定为 `JODConverter + LibreOffice`。
- 这里的选择不是用 `JODConverter` 替代 LibreOffice，而是用它来管理 LibreOffice 进程池、任务队列、超时和失败恢复。

### Artifact Semantics

- 由 legacy Office conversion 生成的 `.docx/.xlsx` 继续只是 normalization artifact，不是新的 source truth。
- provenance / diagnostics / object refs 继续走 shared file asset contract。

## Non-goals

- 不重开 OCR lane、MinerU / Paddle provider routing 或 replay closeout
- 不把 `official_web` linked-file adoption 拉回这条 phase
- 不把 `authenticated_notice file_release`、regulation downstream consumption、query-serving reopening 混入本 phase
- 不把 modern OOXML、PDF、image backend 重新做一轮选型

## Expected Write Surface

- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-h-libreoffice-conversion-runtime-productization/*`
- `.planning/workstreams/shared-file-asset-loader-contract/STATE.md`
- `.planning/workstreams/shared-file-asset-loader-contract/ROADMAP.md`
- `.planning/WORKSTREAMS.md`
- `.planning/PROJECT.md`
- `docs/plans/archive/completed/shared-file-asset-loader-contract.md`
- 后续执行期预计还会触及：
  - `packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py`
  - `apps/ingestion-worker/**`
  - `docs/architecture/file-asset-loader-architecture.md`
  - `docs/environment/**`
  - `docs/runbooks/**`
  - 相关 tests
