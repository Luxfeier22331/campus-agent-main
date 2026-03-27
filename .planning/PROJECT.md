# Campus Agent

## What This Is

`campus-agent` 是一个面向学生、教职工和潜在考生的 multi-agent 校园问答助理仓库，长期形态是以 `supervisor` 作为唯一入口、`specialist agent` 作为能力边界的 supervisor-led orchestration system。当前 v1 的重点不是做全量校园知识问答，而是在新架构下先跑通 `student_handbook` 的 agentic RAG 全链路，并让 `supervisor -> rag-specialist -> retrieval` 主路径稳定成立。与此同时，若存在长期稳定、可复用、非 handbook-RAG 的能力边界，例如官网探活 / 外部站点可达性核验，也允许以独立 specialist 的形式作为当前里程碑中的显式 inserted phase 落地，而不是被降级成 supervisor 内联 tool。旧仓库 `../campusRAG` 只作为迁移参考，不再作为继续扩展的主实现。

## Core Value

先把新的 supervisor-led multi-agent 架构站稳，并用 `student_handbook` 的完整 agentic RAG 主流程证明这条架构能可靠替代高频人工答疑。

## Requirements

### Validated

- ✓ 仓库已经建立 supervisor-led 的长期架构边界与 phase-1 约束文档，明确 `apps/` 与 `packages/` 的职责划分 — existing
- ✓ 已存在 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core` 的主链路骨架与共享 contract 边界 — existing
- ✓ 已存在 ingestion/data plane 基础设施骨架，可支持 `student_handbook` 与 `curriculum_plan` 的 raw / processed / chunk 路径演进 — existing
- ✓ 已完成 `student_handbook` 的 canonical raw onboarding、稳定逻辑文档 identity/version 规则与 machine-checkable duplicate/update import reporting — Validated in Phase 2
- ✓ 已完成 `student_handbook` 的 canonical processed artifact、chunk metadata 与 Qdrant/retrieval payload handoff 收口 — Validated in Phase 3
- ✓ 已将边界清晰的 `official-web` / `availability` specialist 纳入当前执行，以独立 contract、supervisor 显式路由与 allowlisted 官方站点探活能力完成最小闭环 — Validated in Phase 03.1
- ✓ 已完成 `student_handbook` 的 `rag-specialist` answer path 收口，包括 grounded answer、chunk-level citation、`needs_clarification`、`no_answer` 与 `error` 语义 — Validated in Phase 4
- ✓ 已完成 `student_handbook` retrieval baseline 从 dense-only bootstrap 收口为 `dense + sparse hybrid + RRF + registry-backed evidence`，并通过 live handbook fixture 与 repo tests 验证 — Validated by 2026-03-27 live + automated verification
- ✓ 已完成 `supervisor -> specialist` 查询入口、typed actor propagation 与 durable audit logging 的 Phase 5 收口 — Validated in Phase 5
- ✓ 已完成 Cloudflare public-entry Worker runtime shell、trusted-origin forwarding 与 `apps/supervisor-api` trusted-worker origin admission — Validated in Phase 04.6
- ✓ 已完成 `public-consumer-chat` 的 app boundary / frontend host / auth-and-storage decision closeout，并已把实现与文档基线合入 `main` — Validated in Phase 04.7

### Active

- [ ] 为 `student_handbook` 主链路补齐基础 eval / smoke / release-gate 验证，证明问答、失败与澄清分支可验证
- [ ] 在 release gate 中验证 `curriculum_plan` offline-only 产物与 query-disabled 不变量，同时保持其不进入 query-serving

### Out of Scope

- `curriculum_plan` query-serving 上线 — 本阶段只做 raw 导入、清洗和 chunking，不开放查询
- 全 corpus 上线 — v1 只证明 `student_handbook` 的完整问答主链路
- 更细粒度的角色差异化问答行为 — 当前只做到 identity / groups 透传与 retrieval 前 ACL 过滤
- 复杂的多 specialist 串并行协作与 workflow engine — 先把显式 routing、handoff 和单条主链路骨架立住
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
| specialist 表示稳定能力边界，不只等于 handbook RAG | 如果官网探活 / 可达性核验是长期稳定需求，应作为独立 specialist 讨论，而不是退回 supervisor 内联 tool | — Pending |
| `official-web` / `availability` specialist 进入当前里程碑，但以 inserted phase 并行推进 | 这是长期稳定能力边界，且可以在不改写 handbook mainline 的前提下提前验证 supervisor 的多 specialist 形态 | — Validated in Phase 03.1 |
| handbook raw onboarding 必须先进入 raw bucket + raw asset registry，再允许 OCR normalized ingestion | Phase 2 要证明 raw/document truth 分层成立，不能退回本地文件路径兼容方案 | — Validated in Phase 2 |
| handbook duplicate/update 判定基于 `document_id + revision_track` 的历史内容哈希，并通过 import report 显式暴露 created/updated/skipped buckets | 后续 Phase 3/4 需要稳定的版本推进与可审计回归证据 | — Validated in Phase 2 |
| handbook chunking 必须从 registry 指向的 `document-units.jsonl` 重建，并让 ingestion/retrieval 之间共享同一套 evidence-trace metadata | Phase 3 要证明 processed truth、Qdrant payload 和 retrieval evidence shaping 已经收口 | — Validated in Phase 3 |
| `representation` 作为 Qdrant payload alias 保留在 ingestion/retrieval 边界内，shared contract 继续使用 `revision_track` | 这样可以补齐 retrieval payload 语义，同时避免 contract 泄漏或兼容层扩散 | — Validated in Phase 3 |
| `student_handbook` retrieval baseline 不再以 dense-only bootstrap 视为 accepted truth，而是升级为 `dense + sparse hybrid + RRF`，并保持 registry-backed evidence contract 不变 | handbook/规章类语料需要 sparse exact-match 与 semantic recall 同时成立；仅冻结 dense-only 已不符合当前 accepted implementation direction | — Accepted on 2026-03-26 |
| handbook embedding baseline 固定为 `Qwen3-Embedding-4B @ 2560`，不得依赖兼容 API 默认 `1024` 维返回 | 当前 collection/query runtime 必须围绕统一向量宽度重建和验证，不能继续容忍 provider 默认维度漂移 | — Accepted on 2026-03-26 |
| handbook chunk-truth 调整必须先经过真实 validation 与 sample markdown 复核，再允许继续 embedding 或进入 retrieval/eval 调参 | 这次问题说明仅靠单元测试不足以覆盖 handbook 的真实 cleanup/chunking 退化；必须把 live validation 和真实样本内容作为阶段门禁 | — Re-confirmed on 2026-03-26 |
| `rag-specialist` answer path now fail-closes ambiguous, empty-support, and retrieval-failure outcomes while composing grounded chunk-cited answers from the accepted hybrid evidence bundle | Phase 4 must close handbook answer semantics without reopening retrieval strategy or shifting policy back into supervisor | — Validated in Phase 4 |
| `bearer` auth is now runtime-owned and no longer trusts client-supplied `x-actor-*` headers; `trusted-worker` projects final caller actor claims from forwarded Access JWT payload after origin trust is verified | Phase 5 must close actor propagation and ACL safety without moving auth/provider semantics into `packages/*` | — Validated in Phase 5 |
| durable audit logging lives at the API shell boundary while supervisor-core remains the owner of audit record shape | This preserves runtime ownership for persistence and package ownership for schema/projection | — Validated in Phase 5 |
| Cloudflare 并行后续工作拆成 `04.2` / `04.3` / `04.4` 三个 inserted phase | 主线被 chunk-truth 阻塞时，可以继续推进 edge/runtime/panel-shell 冻结，但必须避免把 provider、identity、ACL、audit 语义推入 `packages/*` 或提前吃掉 Phase 5 | — Pending in Phase 04.x |
| Cloudflare public answer path now runs through `apps/public-entry-worker -> apps/supervisor-api` with explicit trusted-worker origin auth | 先把 public-entry runtime seam 做成真实可验证代码，再把 app-layer actor/ACL/audit留给 Phase 5 | — Validated in Phase 04.6 |
| `public-consumer-chat` 的 app-level 用户系统固定采用 `Better Auth + Supabase Postgres`，auth/chat 同库分 schema，Qdrant 继续承担在线 retrieval 主存储 | 这样可以避免 `D1 + Postgres` 双真相源、保持 conversation ownership 与 session 一致性，并且不把在线 chunk/vector retrieval 拉回关系库 | — Accepted on 2026-03-26 |
| `public-consumer-chat` 的前台宿主固定采用 `TanStack Start`，而不是单独 client router 或 `React Router framework mode` | 这个 app 需要 app-local full-stack boundary 来承载 route、auth handler、session、conversation CRUD 与 ownership guard；若只用 client router，会重新制造边界分裂 | — Accepted on 2026-03-26 |

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
*Last updated: 2026-03-27 after syncing mainline 04.7 closeout with Phase 6-complete project state*
