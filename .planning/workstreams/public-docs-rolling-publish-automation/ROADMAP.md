---
doc_type: roadmap
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Roadmap: Public Docs Rolling Publish Automation

## Overview

这条 workstream 固定解决 `apps/public-docs` 如何从 ingestion-maintained manifest
滚动发布的问题。

核心形态是：scheduled runner 读取 manifest pointer，比较 digest，必要时执行
`sync -> build -> smoke -> deploy`，并写入 deploy ledger。manifest 无变化时跳过。

## Phases

- [x] **Phase 1: Manifest Check Contract And Release Ledger**
  — 冻结 current manifest pointer、digest/release id comparison、release ledger schema、
  dry-run output、状态机与 validation gates。
- [x] **Phase 2: Scheduled Runner And Single-flight Lock**
  — 落地北京时间 `00:00 / 06:00 / 12:00 / 18:00` 的 scheduled check，
  controlled runner 使用 UTC `7 4,10,16,22 * * *` 触发，并补齐 lock / no-change skip /
  stale-run cleanup。
- [x] **Phase 3: Build, Smoke, And Deploy Pipeline Integration**
  — 把 changed manifest 接到 `apps/public-docs` 的
  `build:published-reader-assets`、preview smoke、`wrangler deploy` / staging deploy
  与 deployment id capture。
- [x] **Phase 4: Failure Handling, Retry, And Rollback Drill**
  — 明确 build/smoke/deploy 失败不推进 deployed ledger；补齐 retry policy、manual
  rollback command、Cloudflare rollback evidence 与 previous-release continuity。
- [x] **Phase 5: Optional Deploy Hook Nudger**
  — 接入 webhook / deploy-hook 作为即时触发，但只触发 manifest check，不信任 payload
  直接发布。
- [x] **Phase 6: Production Acceptance And Operator Runbook**
  — 完成 staging/prod dry-run、no-change、changed-manifest、failure、rollback
  证据与 operator 文档，收口为可长期运行的发布节奏。
