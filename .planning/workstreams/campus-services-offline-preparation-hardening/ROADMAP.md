---
doc_type: roadmap
status: completed
created: 2026-04-20
updated: 2026-04-20
---

# Roadmap: Campus Services Offline Preparation Hardening

## Overview

这条 workstream 只负责 `campus_services/*` 在 `offline_preparation` 阶段的定向质量硬化。
当前首条切片固定为 handbook-derived `service_catalog` 服务流程图文档，
目标是把 `中央民族大学学生公寓管理工作流程` 从“source truth 已声明但正文退化”为“可稳定物化的 bounded navigation document”。

## Phases

- [x] **Phase 1: Service Navigation Projection Contract Freeze** — 冻结 handbook-derived `service_navigation_document` 的 selector、materialization boundary、lineage 字段与 fail-close 口径。
- [x] **Phase 01.1: Bounded Service Navigation Multimodal Probe And Admission** — 基于真实页图 probe 判断多模态 lane 是否值得被 admission 为这条流程图的 bounded target-side extraction 能力。
- [x] **Phase 2: Bounded Handbook Service Navigation Hybrid Materialization** — 保留 OCR provenance，并为 image-heavy 服务流程图补齐受限多模态 body/edge recovery 与 target-local artifacts。
- [x] **Phase 3: Service Navigation Targeted Verification And Rebuild Integration** — 收口 title-only degradation gate、targeted rebuild / replay integration 与相关验证。
- [x] **Phase 4: Planning Closeout And Follow-up Routing** — 把服务流程图硬化的 evidence、剩余 gap 与后续 `campus_services` follow-up 路由写回 planning truth。

### Phase 1: Service Navigation Projection Contract Freeze

**Goal:** 冻结 handbook-derived `service_navigation_document` 的 selector、materialization boundary、lineage 字段、fail-close 规则与首条 bounded slice。
**Requirements**:
- handbook-derived `service_navigation_document` 继续由 source-truth selector 驱动
- 不返回 whole-handbook replay，也不新增 raw-wide consumption lane
- 明确 `Phase 2` 的 bounded OCR materialization 只作用于声明页范围
**Depends on:** Phase 0
**Plans:** 1 plan

Plans:
- [x] `01-service-navigation-projection-contract-freeze/PLAN.md` — 冻结 selector/page semantics、artifact contract、lineage 与 fail-close 口径

### Phase 01.1: Bounded Service Navigation Multimodal Probe And Admission (INSERTED)

**Goal:** 基于真实页图 probe 判断多模态 lane 是否值得被 admission 为 handbook-derived `service_navigation_document` 的 bounded extraction 能力，并冻结 admission gate。
**Requirements**:
- 只处理 `252-255` 页，不扩大 source range
- 不把多模态 probe 直接升级成 source-truth 或 repo-wide parser lane
- 明确 `Phase 2` 是否继续 OCR-only，还是升级为受控的 hybrid extraction lane
**Depends on:** Phase 1
**Plans:** 1 plan

Plans:
- [x] `01.1-bounded-service-navigation-multimodal-probe-and-admission/PLAN.md` — 冻结 per-page PNG probe、strict schema、稳定性 gate 与 admission outcome rubric
- [x] `01.1-bounded-service-navigation-multimodal-probe-and-admission/SUMMARY.md` — 基于 3 次真实多图 probe 执行 admission gate，并把 outcome 冻结为 bounded production materialization candidate
### Phase 2: Bounded Handbook Service Navigation Hybrid Materialization

**Goal:** 为首条 service navigation 文档实现 `OCR provenance + constrained multimodal body/edge recovery` 的 bounded hybrid materialization，并生成 target-local `flow-graph.json` / `canonical.md` / `document-units.jsonl`。
**Requirements**:
- 只处理声明的 source page range
- 保留现有 OCR provider response 作为 provenance，而不是绕过 OCR artifacts
- 多模态只用于当前 bounded slice 的 flowchart body / edge recovery
- 不把 `service_catalog` 变成通用 OCR 查询器或 repo-wide multimodal parser
**Depends on:** Phase 01.1
**Plans:** 1 plan

Plans:
- [x] `02-bounded-handbook-service-navigation-ocr-materialization/PLAN.md` — 冻结 exact projection dispatch、declared-page PNG rendering、`flow-graph.json` artifact、raw/replay convergence 与 fail-close tests
- [x] `02-bounded-handbook-service-navigation-ocr-materialization/SUMMARY.md` — 记录 bounded hybrid lane 已在 `ingestion-core` 落成实现，并附 targeted unittest verification evidence

### Phase 3: Service Navigation Targeted Verification And Rebuild Integration

**Goal:** 收口 title-only degradation fail-close gate，并把 bounded materialization 接入 targeted rebuild / replay verification。
**Requirements**:
- 验证 selector 不越界
- 验证 image-heavy 页面在无正文时 fail-close
- 验证 targeted rebuild 不影响其他 handbook projections
**Depends on:** Phase 2
**Plans:** 2 plans

Plans:
- [x] `03-service-navigation-targeted-verification-and-rebuild-integra/PLAN.md` — 冻结 selector non-expansion、fail-close semantics、raw/replay convergence 与 rebuild cleanup closeout
- [x] `03-service-navigation-targeted-verification-and-rebuild-integra/SUMMARY.md` — 记录 selector exactness、fail-close regressions、raw/replay convergence 与 cleanup accounting 的通过证据

### Phase 4: Planning Closeout And Follow-up Routing

**Goal:** 将服务流程图硬化 evidence、剩余 gap 和后续 `campus_services` follow-up 路由写回 planning truth。
**Requirements**:
- 冻结首条 bounded slice closeout 口径
- 明确哪些后续问题留在 `campus_services` 线内，哪些不纳入长期产品消费
**Depends on:** Phase 3
**Plans:** 2 plans

Plans:
- [x] `04-planning-closeout-and-follow-up-routing/PLAN.md` — 冻结 completion statement、remaining-gap routing、registry truth update 与 reopen rule
- [x] `04-planning-closeout-and-follow-up-routing/SUMMARY.md` — 记录 completed truth、repo registry closeout 与 future reopen rule
