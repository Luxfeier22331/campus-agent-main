---
doc_type: phase_spec
phase: "C"
phase_name: "Shared Normalization And Extraction Substrate"
status: planned
created: 2026-04-19
updated: 2026-04-19
---

# Phase C Spec

## Objective

把 Phase B 已冻结的 family decisions 落成 `packages/ingestion-core` 内可复用的 shared normalization / extraction substrate，让后续 source channel 可以接 shared contract，而不再各自拥有 parser truth。

## Requirements

1. Phase C 必须在 `packages/ingestion-core` 落 package-owned shared contract，不把 file asset truth 留在 worker wrapper 或 source-specific projection module。
2. shared contract 必须显式表达：
   - asset descriptor
   - normalization outcome
   - extraction outcome
   - terminal outcome
   - artifact provenance
3. legacy binary Office（`.doc/.xls`）必须通过 external conversion seam 进入 admitted OOXML，再进入 deterministic extraction；Phase C 不允许继续以 `xlrd` 或 source-specific binary parsing 作为 forward contract。
4. modern OOXML（`.docx/.xlsx`）必须把 deterministic extraction 从 `authenticated_notice_source_projections.py` 抽离成 shared substrate，并保持当前已验证的 text/table semantics。
5. PDF / image routing 必须复用 Phase B 已冻结的 lane：
   - PDF: `MinerU primary`, `Paddle fallback-only`
   - document image: `MinerU primary`
   - simple image: `Paddle primary`
   - spatial / map-like: fail-close
   - semantic image: 非 canonical OCR，保留 multimodal enrichment seam
6. terminal outcomes 与 provenance artifact refs 必须保持 repo-owned 语义，不允许让 provider 私有 success/failure 状态替代 canonical outcome。
7. Phase C 不迁移 `authenticated_notice` 业务调用点，不改 `official_web` page-level source unit，不打开 query-serving / release / alias publish。

## Non-Goals

- 不在本 phase 直接改写 `authenticated_notice_source_projections.py` 的调用方接线
- 不在本 phase 实现 source migration
- 不在本 phase 引入新的 parser/provider brand reopen
- 不在本 phase 扩 scope 到 `official_web`、retrieval、panel/chatbot、evals

## Exit Criteria

- shared file asset substrate 的 module layout、contract nouns、family adapters 与 routing module 已在 `packages/ingestion-core` 落盘
- worker-side legacy Office wrapper 降级为 thin runtime shell，不再拥有 forward contract
- OOXML extraction 与 PDF/image routing 已能被下游 source path 复用
- focused package tests 已覆盖 legacy Office normalization seam、OOXML extraction、routing / terminal semantics
- Phase D 可以直接做 `authenticated_notice` attachment migration，而不是继续做 substrate 选型
