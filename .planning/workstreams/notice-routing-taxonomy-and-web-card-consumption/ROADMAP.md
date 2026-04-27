---
doc_type: roadmap
status: active
created: 2026-04-28
updated: 2026-04-28
---

# Roadmap: Notice Routing Taxonomy And Web Card Consumption

## Phase 0: Planning Truth And Baseline Audit

**Status:** active

**Goal:** 建立 native workstream，并记录当前 notice routing / read-model baseline。

**Scope:**

- workstream README / REQUIREMENTS / ROADMAP / STATE
- `.planning/WORKSTREAMS.md` active registry
- current read-model title/source_url audit result
- boundary with completed `notice-consumption-layer`

## Phase 1: Routing Matrix Review

**Status:** pending

**Goal:** 复核 family、route、target surface、status 的当前矩阵。

**Scope:**

- `notice_family_classification.v1.json`
- `internal_notice_consumer_admission_builder`
- procurement/history, service-status candidate, notice-level query
- defer / no_adoption / review_later residual
- machine-processing policy and multimodal spend boundary

## Phase 2: Minimum Web Card Contract

**Status:** pending

**Goal:** 冻结所有 queryable notice 的最低 Web card 字段和 fail-close 规则。

**Scope:**

- read-model `title/source_url` completeness
- `campus_notice_discover` card fields
- `campus_notice_get` reference-only behavior
- canonical_url fallback policy
- Web response shape acceptance

## Phase 3: Procurement History Pilot Batch

**Status:** pending

**Goal:** 用采购 notice 作为第一批 selected admission 代表，验证轻量历史查询。

**Scope:**

- selected procurement notice list
- admission manifest
- consumption projection/read-model rebuild
- `target_surface=procurement_notice_history`
- title/url discover/get acceptance

## Phase 4: Low-Priority Notice Minimum Consumption

**Status:** pending

**Goal:** 明确低优先级 notice 的分类、分流、检索和 title/url 卡片策略。

**Scope:**

- lecture/publicity/event/campus-news low-priority families
- skip machine-processing policy
- queryable vs non-queryable boundary
- review_later audit residual
- representative Web card examples

## Phase 5: Eval And Closeout

**Status:** pending

**Goal:** 固化 routing/card acceptance gate，并关闭本 workstream。

**Scope:**

- routing taxonomy eval fixture update
- read-model title/url completeness audit command
- procurement/history card acceptance
- low-priority card acceptance
- closeout docs and reopen rule
