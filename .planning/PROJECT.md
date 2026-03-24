# Campus Agent

## What This Is

`campus-agent` 是一个面向学生、教职工和潜在考生的 multi-agent 校园问答助理仓库，长期形态是以 `supervisor` 作为唯一入口、`specialist agent` 作为能力边界的 supervisor-led orchestration system。当前 v1 的重点不是做全量校园知识问答，而是在新架构下先跑通 `student_handbook` 的 agentic RAG 全链路，并让 `supervisor -> rag-specialist -> retrieval` 主路径稳定成立。旧仓库 `../campusRAG` 只作为迁移参考，不再作为继续扩展的主实现。

## Core Value

先把新的 supervisor-led multi-agent 架构站稳，并用 `student_handbook` 的完整 agentic RAG 主流程证明这条架构能可靠替代高频人工答疑。

## Requirements

### Validated

- ✓ 仓库已经建立 supervisor-led 的长期架构边界与 phase-1 约束文档，明确 `apps/` 与 `packages/` 的职责划分 — existing
- ✓ 已存在 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core` 的主链路骨架与共享 contract 边界 — existing
- ✓ 已存在 ingestion/data plane 基础设施骨架，可支持 `student_handbook` 与 `curriculum_plan` 的 raw / processed / chunk 路径演进 — existing
- ✓ 已完成 `student_handbook` 的 canonical raw onboarding、稳定逻辑文档 identity/version 规则与 machine-checkable duplicate/update import reporting — Validated in Phase 2
- ✓ 已完成 `student_handbook` 的 canonical processed artifact、chunk metadata 与 Qdrant/retrieval payload handoff 收口 — Validated in Phase 3

### Active

- [ ] 跑通 `student_handbook` 的完整 agentic RAG 链路，包括 ingestion、retrieval query-serving、`supervisor -> rag-specialist` handoff、citation/source 返回、tracing、audit 与 ACL 最小闭环
- [ ] 让 `supervisor` 作为唯一入口稳定路由到 `rag-specialist`，并保持清晰 handoff contract 与正确架构边界
- [ ] 将身份与权限最小闭环落到请求级透传与 retrieval 前 ACL 过滤，面向学生、教职工和潜在考生三类用户预留访问边界
- [ ] 为 `student_handbook` 主链路补齐基础 eval / smoke 验证，证明问答、失败与澄清分支可验证
- [ ] 并行推进 `curriculum_plan` 的 raw 导入、清洗与 chunking，为后续开放 query-serving 做准备，但本阶段不放开查询

### Out of Scope

- `curriculum_plan` query-serving 上线 — 本阶段只做 raw 导入、清洗和 chunking，不开放查询
- 全 corpus 上线 — v1 只证明 `student_handbook` 的完整问答主链路
- 更细粒度的角色差异化问答行为 — 当前只做到 identity / groups 透传与 retrieval 前 ACL 过滤
- 多 specialist 串并行协作、复杂 workflow engine — 先把单 specialist 的正确骨架立住
- 完整会话记忆、HITL / approval flow、生产级运维硬化 — 这些属于后续阶段能力，不作为当前初始化范围

## Context

当前真人答疑群里存在大量校园相关问题，需要人工持续回答，已经形成明显的人力消耗；这个项目的直接业务背景就是用结构正确的校园问答助理承接这些高频问答。仓库本身是 brownfield：`docs/` 中已有长期架构、phase-1、supervisor 架构与实施计划文档，`.planning/codebase/` 也已经记录了当前代码地图。技术上，新仓库采用 supervisor-led multi-agent 方向，`../campusRAG` 是旧的 RAG 实现，只作为迁移参考；迁移目标不是复制旧接口，而是用新的 contract、retrieval abstraction 和 supervisor/specialist 边界重建主链路。

## Constraints

- **Architecture**: `supervisor` 必须是唯一入口协调层，`specialist` 作为稳定能力边界存在，不能退回成旧 `campusRAG` 的扁平 tool 模式 — 这是仓库长期架构和当前 supervisor 设计的核心前提
- **Scope**: phase-1 只开放 `student_handbook` query-serving，`curriculum_plan` 仅做到 raw 导入、清洗和 chunking — 避免范围扩张破坏主链路收敛
- **Contracts**: handoff 必须通过 `packages/contracts` 中的 schema 完成，不让 AgentOS / retrieval / infra 类型渗透进共享 contract — 这是未来可替换 specialist / retrieval 的基础
- **Runtime Boundary**: runtime 与 transport 逻辑留在 `apps/`，尤其是 `apps/supervisor-api`；`packages/supervisor-core` 只负责 request framing、routing、policy、response shaping、audit projection — 避免框架宿主反向污染编排层
- **Security**: v1 必须做到身份透传、trace 透传、retrieval 前 ACL 过滤、最小审计和最小 source traceability — 这是面向不同权限用户上线前的最低治理要求
- **Execution Goal**: 当前优先级是把新架构站稳，不以覆盖更多知识域或更复杂 agent 能力为第一目标 — 避免为了功能面牺牲边界正确性

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1 只开放 `student_handbook` query-serving | 先用一个清晰知识域证明新架构可用，避免多 corpus 同时上线扩大复杂度 | — Pending |
| `curriculum_plan` 本阶段只做 raw 导入、清洗和 chunking | 该链路可以并行推进，但不应打断 `student_handbook` 主流程收口 | — Pending |
| 权限最小闭环只做到 identity / groups 透传与 retrieval 前 ACL 过滤 | 先满足多类用户的最小访问控制，再延后更细粒度角色行为 | — Pending |
| 旧 `../campusRAG` 仅作为迁移参考 | 新仓库目标是新架构落地，不是继续扩展旧实现 | — Pending |
| phase-1 先优先架构边界正确、handoff 清晰、tracing / audit / ACL 最小闭环 | 这是“符合最佳实践”的核心，也是后续扩展多 specialist 的前置条件 | — Pending |
| handbook raw onboarding 必须先进入 raw bucket + raw asset registry，再允许 OCR normalized ingestion | Phase 2 要证明 raw/document truth 分层成立，不能退回本地文件路径兼容方案 | — Validated in Phase 2 |
| handbook duplicate/update 判定基于 `document_id + revision_track` 的历史内容哈希，并通过 import report 显式暴露 created/updated/skipped buckets | 后续 Phase 3/4 需要稳定的版本推进与可审计回归证据 | — Validated in Phase 2 |
| handbook chunking 必须从 registry 指向的 `document-units.jsonl` 重建，并让 ingestion/retrieval 之间共享同一套 evidence-trace metadata | Phase 3 要证明 processed truth、Qdrant payload 和 retrieval evidence shaping 已经收口 | — Validated in Phase 3 |
| `representation` 作为 Qdrant payload alias 保留在 ingestion/retrieval 边界内，shared contract 继续使用 `revision_track` | 这样可以补齐 retrieval payload 语义，同时避免 contract 泄漏或兼容层扩散 | — Validated in Phase 3 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state (users, feedback, metrics)

---
*Last updated: 2026-03-24 after Phase 3 completion*
