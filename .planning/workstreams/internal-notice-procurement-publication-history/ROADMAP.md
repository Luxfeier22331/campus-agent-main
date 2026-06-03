---
doc_type: roadmap
status: backlog
created: 2026-04-24
updated: 2026-04-28
---

# Roadmap: Internal-Notice Procurement Publication History

当前为 backlog draft，不代表 active execution order。首期产品口径不把采购类
notice 作为独立 downstream pilot；采购与讲座、活动、一般公告一样，先走
generic PG notice search/title-url card。恢复为 active workstream 前，应先确认
产品范围确实要把采购类从 generic notice search/card 提升为
procurement-specific facet/history surface。

## Phase 1: Current-State Contract Audit

**Goal:** 确认当前 notice read model、Go structured query、notice-agent 与
Web-facing response 是否都保持 title + url contract。

**Scope:**

- `InternalNoticeReadModelEntry.title/source_url`
- `NoticeCard.title/source_url`
- `CampusNoticeGetResult.title/source_url`
- `campus_notice_discover/get` response shape
- missing-title/url fail-close 或 data-quality report

## Phase 2: Deferred Procurement-Specific Query Facet

**Goal:** 仅在产品范围恢复后，固化采购历史通过
`target_surfaces=["procurement_notice_history"]` 检索，不新增 dedicated
procurement tool。

**Scope:**

- procurement title/query examples
- `355222` / `355325` acceptance cases
- date and organization metadata preservation
- restricted auth boundary

## Phase 3: Low-Priority Notice Minimum Consumption

**Goal:** 明确不是所有 notice 都要深处理；低优先级 notice 只需正确分类、
分流、检索命中并返回 title/url。

**Scope:**

- `defer` / `no_adoption` 与 queryable admission 的边界
- low-value publicity/event notice skip policy
- machine-processing skip vs title/url card availability
- Web card no-body/reference-only rendering

## Phase 4: Web Card Acceptance

**Goal:** 为采购类与低优先级 notice 建立 Web 侧消费验收。

**Scope:**

- card fields and ordering
- source URL display and canonical URL resolution
- no body / reference-only behavior
- public/restricted visibility guard

## Phase 5: Backlog Closeout

**Goal:** 用真实样本关闭 backlog，确认是否需要从 generic notice search/card
提升到 procurement-specific facet；默认仍不需要独立 procurement runtime。

**Scope:**

- procurement notice exemplar set
- title/url completeness review
- no-regression check against existing regulation lanes
- low-priority notice exemplar set
- planning closeout
