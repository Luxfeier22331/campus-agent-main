---
workstream: shared-file-asset-loader-contract
created: 2026-04-19
updated: 2026-04-19
---

# Project State

## Current Position

**Status:** In Progress
**Current Phase:** B
**Current Phase Name:** Bounded Backend Evaluation
**Current Plan:** `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/PLAN.md`
**Total Phases:** 6
**Total Plans in Phase:** N/A
**Progress:** 1/6 phases complete
**Last Activity:** 2026-04-19
**Last Activity Description:** Executed the first Phase B benchmark-evidence pass by running targeted ingestion tests and recording the results into `BENCHMARK-EVIDENCE.md` and the draft `DECISION-PACKAGE.md`.

## Current Slice

- Phase A 已完成：shared owner、contract vocabulary、asset family tranches、provider/deployment posture 与 source-specific guardrails 已冻结
- 当前 focus 切到 Phase B：Phase B research 与 planning artifacts 已落盘，且第一批 synthetic benchmark evidence 已写入 canonical phase docs
- `official_web` page-level projection 继续留在 source-specific path，不并入 generic file loader
- `authenticated_notice` attachment path 仍是首个迁移目标，但 Phase B 只做 backend evaluation，不做 source migration
- Phase B 必须收口的 open items：
  - 补 semantic-image 的 direct repo evidence
  - 补 future `.xls` conversion-first route 的 stronger end-to-end evidence
  - 在剩余缺口关闭后，把 draft `DECISION-PACKAGE.md` 提升成 final closeout truth

## Blockers

- 目前没有 repo-level blocker
- 真正待裁决的是：
  - final benchmark-backed semantic-image trigger
  - final benchmark-backed future `.xls` conversion-first route
  而不是继续回到“是否还要保留 Docling/OpenDataLoader 为默认方向”这种已关闭问题

## Verification

- 已确认本地代码真相：
  - `authenticated_notice_source_projections.py` 当前仍混合 attachment classification、native extraction 与 terminal outcomes
  - `.doc` normalizer 目前只存在于 worker app 壳，不是 package-level shared capability
  - `.xls` 当前仍直接依赖 `xlrd`，`.xlsx` 当前仍走 source-specific 自写 XML 解析；这是 current code truth，不反向定义 future tranche adapter
  - 当前 repo 没有运行时 `openpyxl` 依赖路径
  - `official_web` 已有独立 page-level projection path，不应被 generic file loader 吃掉
- 已核对外部官方资料：
  - MinerU official docs
  - PaddleOCR / PaddleOCR-VL official docs
  - OmniDocBench public benchmark
  - OpenDataLoader official docs
  - LibreOffice / Collabora / JODConverter official docs
  - Microsoft Learn WordprocessingML / SpreadsheetML / shared strings / formulas docs
  - python-docx official docs
- 已确认本机环境：
  - `java` absent
  - `soffice` absent
  - `docker` present
  - `uv` present
  - `pnpm` present

## Session Continuity

**Stopped At:** First-wave synthetic benchmark evidence is recorded. Next session should close the two remaining evidence gaps, then finalize `DECISION-PACKAGE.md` and decide whether Phase B can be closed.
**Resume File:** `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/DECISION-PACKAGE.md`
