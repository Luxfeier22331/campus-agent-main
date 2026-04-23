---
doc_type: roadmap
status: active
created: 2026-04-23
updated: 2026-04-23
---

# Roadmap: Handbook Curriculum MinerU Cutover

## Overview

这条 workstream 负责 `student_rules` 与 `curriculum_plan`
的 MinerU source-truth 覆盖式切换。
它是独立数据面收口线，
不再混入已完成的 shared product surface / docs shell workstream。

## Phases

- [x] **Phase 1: Freeze Current Truth And Rollback Evidence**
  — 冻结当前 runtime profile、已知坏样例、source bucket / release manifest / alias rollback 边界。
- [x] **Phase 2: Source Truth Hard Gate And Runtime Alignment**
  — 补齐 handbook source-truth fail-close，
  对齐 runtime profile、测试与前向 runbook/reference 到 MinerU v2。
- [ ] **Phase 3: Shadow Rebuild And Docs Refresh**
  — 对 `student_rules` 与 `curriculum_plan`
  执行 `raw_online_ocr --no-publish-alias` shadow rebuild，
  并刷新 docs consumption truth 做抽检。
- [ ] **Phase 4: Release Dry Run And Acceptance**
  — 执行 release dry run、benchmark/live smoke，
  记录 release manifest 与 known-bad sample 消失证据。
- [ ] **Phase 5: Alias Publish And Closeout**
  — 先发布 `curriculum_plan`，再发布 `student_rules`，
  完成 alias 切换、post-publish smoke 与 continuity closeout。
