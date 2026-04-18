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

- [x] **Phase A: Shared Contract And Boundary Freeze** — 冻结 shared loader 的抽象层、terminal outcomes、provenance、source-specific guardrails，以及 admitted family tranches。
- [ ] **Phase B: Bounded Backend Evaluation** — 用真实样本比较 admitted families 的 bounded backend 组合；`.xls` 与 `.doc` 同属 legacy binary Office tranche，`.xlsx` 与 `.docx` 同属 modern OOXML tranche。
- [ ] **Phase C: Shared Normalization And Extraction Substrate** — 在 `packages/ingestion-core` 落 package-level substrate。
- [ ] **Phase D: Authenticated Notice Attachment Migration** — 把 `authenticated_notice` attachment path 中的 admitted families 迁到 shared substrate，并分别收口 legacy binary Office（`.doc/.xls`）与 modern OOXML（`.docx/.xlsx`）路径。
- [ ] **Phase E: Cross-Scope Adoption Matrix And Hardening** — 评估后续 adoption、验证矩阵与文档/runbook 硬化。
- [ ] **Phase F: Planning Closeout And Follow-up Routing** — 关闭 planning 漂移，并把剩余 follow-up 正确分流。
