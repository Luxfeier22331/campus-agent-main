---
doc_type: roadmap
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Roadmap: Shared File Asset Loader Contract

## Overview

这条 workstream 覆盖 repo-level shared file asset loader contract。
同一 workstream 内禁止按格式、parser backend 或 source channel 平行拆 lane。

## Phases

- [ ] **Phase A: Shared Contract And Boundary Freeze** — 冻结 shared loader 的抽象层、terminal outcomes、provenance 与 source-specific guardrails。
- [ ] **Phase B: Bounded Backend Evaluation** — 用真实样本比较 Docling / native adapters / LibreOffice normalizer 等 bounded backend 组合。
- [ ] **Phase C: Shared Normalization And Extraction Substrate** — 在 `packages/ingestion-core` 落 package-level substrate。
- [ ] **Phase D: Authenticated Notice Attachment Migration** — 把 `authenticated_notice` attachment path 迁到 shared substrate。
- [ ] **Phase E: Cross-Scope Adoption Matrix And Hardening** — 评估后续 adoption、验证矩阵与文档/runbook 硬化。
- [ ] **Phase F: Planning Closeout And Follow-up Routing** — 关闭 planning 漂移，并把剩余 follow-up 正确分流。
