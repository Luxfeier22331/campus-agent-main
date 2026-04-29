---
doc_type: roadmap
status: completed
created: 2026-04-19
updated: 2026-04-26
---

# Roadmap: Authenticated Notice Live Portal Control Plane

## Overview

这条 workstream 已完成本轮 repo-owned closeout。2026-04-26 的最新 baseline 是：
authenticated notice collector 通过 trusted proxy path 完成 282 条 widened incremental
export，311 个 attachment objects 已上传并导入 source-truth inventory；attachment
fetch-status coverage 当前无缺失 ref，reference-only doctor 的 action-required count 为
0，`.zip` 等不可消费压缩包以 `unsupported_binary` terminal source-truth outcome 表达。

完成顺序如下：

- [x] **Phase A: Collector Runtime / Repo Migration Truth Refresh**
- [x] **Phase B: Auth Bootstrap / Live Capture Policy / Scheduling** — collector run
  admission 已进入 export path；incremental/backfill 无 enabled notice type 时 fail
  closed，selected mode 无 selected notice ids 时 fail closed，manifest 固定写入 admitted
  scope、page budget 与 selected notice truth，供外部 scheduler / operator 复核。
- [x] **Phase C: Run Ledger / Artifact Refs / Auth Readiness** — 补齐 run ledger / artifact refs，并保留 attachment presence signals；正文内联图片已进入 captured attachment ref/entity；fetch-status/reference-only doctor 能区分 terminal portal misses、object-backed inline images 与 action-required gaps。
- [x] **Phase D: Live-Historical Reconcile** — 新增 live-historical reconcile report / CLI，统一输出 current inventory 与 attachment fetch-status 的 missing/extra truth，并把正文声明附件但 payload 未返回 attachment entity/ref 的 owner expectation mismatch 作为 machine-readable action item。
- [x] **Phase E: Operator Control Plane / Bounded Source-channel APIs** — 新增 bounded operator status CLI，聚合 source-truth inventory、fetch-status coverage、reference-only explanation、unsupported binary、multimodal count 与 latest collector run ledger。
- [x] **Phase F: Planning Closeout**
