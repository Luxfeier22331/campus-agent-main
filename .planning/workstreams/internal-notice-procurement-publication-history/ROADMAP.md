---
doc_type: roadmap
status: backlog
created: 2026-04-24
updated: 2026-04-24
---

# Roadmap: Internal-Notice Procurement Notice Classification

当前为 backlog draft，不代表 active execution order。恢复为 active workstream 前，应先确认产品范围确实要支持
在 restricted notice / publication 存储中稳定保留 `procurement_notice` 分类，而不是继续停留在
source-triage / audit-holding。

## Phase 1: Category Boundary Admission

**Goal:** 冻结 `procurement_notice` 与 regulation / service / ordinary notice / news 的边界。

**Scope:**

- `procurement_notice` 分类命名
- 与 `regulations/*`、`campus_services/*`、generic notice 的边界
- restricted source family 下的 storage admission

## Phase 2: Minimal Metadata Contract

**Goal:** 冻结 `procurement_notice` 的最小字段，不引入 `stage`。

**Scope:**

- `publication_category`
- canonical notice fields reuse
- attachment refs
- storage / projection mapping

## Phase 3: Attachment And Authority Semantics

**Goal:** 明确附件型采购通知与正文型采购通知的 authority / completeness 关系。

**Scope:**

- attachment-backed procurement notice handling
- result-like body handling
- declared / captured attachment semantics
- fail-close and holding rules

## Phase 4: Archive-Only Consumption Posture

**Goal:** 明确 `procurement_notice` 的 non-default consumption posture。

**Scope:**

- archive-only / audit-only posture
- restricted visibility and auth boundary
- future history query prerequisites
- non-default route contract

## Phase 5: Worked Example And Acceptance Closeout

**Goal:** 用真实 procurement notice 样本验证分类与 holding truth。

**Scope:**

- procurement notice exemplar set
- metadata completeness review
- no-regression check against existing regulation lanes
- planning closeout
