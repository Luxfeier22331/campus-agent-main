---
doc_type: plan
status: completed
created: 2026-03-28
updated: 2026-04-12
---

# Intent / Memory / Authorization Foundation

## 文档边界

本文只负责把长期设计讨论拆成后续可执行的实现波次、文件落点和验收标准。

本文不负责：

- 重新定义长期边界真相
- 宣布当前阶段已经完成哪些实现
- 冻结具体 prompt、阈值、模型或 provider

对应 source of truth：

- 长期边界：`docs/architecture/target-architecture.md`
- 授权长期边界：`docs/architecture/identity-and-authorization-architecture.md`
- supervisor 长期职责：`docs/architecture/execution-and-specialists-architecture.md`
- rag specialist 长期职责：`docs/architecture/execution-and-specialists-architecture.md`
- app-layer identity / memory ownership：`docs/architecture/product-runtime-architecture.md`
- 编排与安全边界：`docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- identity / memory / personalization 决策：`docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- authorization model / retrieval filter projection：`docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`

## 当前状态

本文状态固定为 `completed`。

原因：

- `.planning/ROADMAP.md` 已把 Phase 11 记为完成，identity / authorization / memory foundation 不再是当前 active execution gap
- `app-api` canonical owner split、typed projection seam、restricted retrieval fail-close 与 non-authorizing memory 基线都已经进入 merged truth
- 当前如果继续推进 memory productization 或更完整的长期记忆能力，应在 `.planning/PROJECT.md` 中显式重开新的 follow-up execution lane，而不是继续把本文当默认实施入口

## 目标

后续实现要把以下长期设计真正落到代码：

- supervisor 具备 typed `IntentFrame`
- `rag-specialist` 具备 retrieval-specific `RagIntentFrame`
- `app-api` 成为 canonical identity / authorization / memory owner
- personalization 进入 answer path，但不稀释 authorization filter
- evals、trace 和 telemetry 可以验证这些边界没有退化

## 完成定义

这轮基础工作完成时，至少应满足：

1. `app-api` 可以输出 canonical actor claims、最小化 authz projection 与 typed memory projection。
2. `supervisor` 不再把 top-level intent 识别等价为“入口已给定 scope”。
3. `rag-specialist` 具备显式的 retrieval-specific intent / clarification / personalization 决策位置。
4. retrieval personalization 只能影响 query planning、clarification 与 answer wording，不能扩大 authorization filter。
5. `packages/evals` 能对 intent / routing / clarification / memory / authorization path 提供可重复验证。
6. telemetry / audit 可以追踪 identity / memory projection 的最小治理字段，而不落 raw sensitive data。

## 当前过渡态记录

以下内容记录的是本文成文时的过渡态背景，用于解释当时的 foundation 拆解方式；它不再代表当前默认执行入口。

截至 2026-03-29，shared contract、`supervisor-api`、`retrieval-core` 与 `rag-specialist` 已经接上长期 authz projection 的主干，但仓库仍处于“迁移中”而不是“完全收口”。

当前已经完成的部分：

- `packages/contracts` 已提供 `AuthorizationProjection` / `AuthorizedRetrievalFilter`
- `retrieval-core` 已优先消费授权投影后的 filter
- `rag-specialist` 已把 `context.authorization.retrieval_filter` 传入 retrieval
- `supervisor-api` 已能在受控前提下接收 projected `ContextProjection`

当前尚未完全结束过渡态的原因：

- `apps/app-api` 还没有成为所有产品 execution path 的唯一 authz projection owner
- 尚未全部删除 top-level `actor` carrier、`snapshot` seam 与 legacy `groups/campus_scope` 依赖
- 仍存在未合入或未对齐的 app/worktree 实现继续沿用旧 execution contract

因此当前正确表述只能是：

- authz long-term direction 已冻结
- shared seam 已经迁移到一半以上
- 过渡态仍未关闭

## 结束过渡态的执行面

要真正关闭当前过渡态，后续实施必须补齐以下几项：

1. `apps/app-api`
   让 principal mapping、authorization projection、memory projection 在同一 execution path 内一次产出，并把 `authorization` 作为 canonical downstream input。
2. app-api supervisor adapter
   从 top-level `actor`/`snapshot` 请求切换到 `SupervisorRequest + ContextProjection`，并统一消费 `SupervisorResponse`。
3. 产品调用面
   panel、chat、operator surface 都必须经由 `app-api` 的 canonical projection path，而不是继续各自保留 legacy actor carrier。
4. compatibility cleanup
   当所有调用面完成切换后，收紧或删除 retrieval / specialist / supervisor 中仅为兼容保留的 legacy `acl_groups/campus_scope` 路径。
5. verification
   app-api 独立测试、shared contract tests、supervisor/retrieval/specialist tests 与仓库级 baseline 必须同时通过。

## 波次拆分

### Wave 1: 文档与 contract 草案冻结

目标：

- 冻结 `IntentFrame`、`RagIntentFrame`、identity / authorization / memory truth layering、personalization 边界

文件落点：

- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`

验收：

- 边界、ownership、forbidden shape 与文档分层关系无冲突
- docs index 已收录新增 canonical docs

### Wave 2: `app-api` principal / authorization / memory projection

目标：

- 在 `app-api` 内建立 canonical actor、authz projection 与 typed memory projection 的最小实现面

预期落点：

- `apps/app-api` auth / profile / chat / runtime-command 相关模块
- 可能需要扩展 `packages/contracts` 中的 actor / authz / request projection schema

必须做到：

- verified identity、authorization truth、profile memory、session memory 分层
- typed projection 默认不含 raw JWT、raw transcript、raw long-term memory
- projection 带 source / confidence / staleness / visibility 语义
- projection 至少包含 entitlement snapshot / ownership / approval 的最小化表达

### Wave 3: authorization projection 与 retrieval filter migration

目标：

- 让 query path 消费 app-layer authz projection，而不把当前 phase-1 filter carrier 误升为长期 canonical model

预期落点：

- `apps/app-api`
- `packages/contracts`
- `packages/retrieval-core`

必须做到：

- serving filter、authorization filter 与 applicability hint 的职责分离
- `acl_level` / `acl_groups` / `campus_scope` 继续作为 transitional shape 时，也明确标注为 projection carrier
- candidate retrieval 前的 authz filter 仍保持 fail-closed
- 新 contract 不再把 raw token claims 直接暴露给 retrieval path

### Wave 4: supervisor `IntentFrame`

目标：

- 让 top-level intent framing 不再依赖入口预填 scope 作为唯一真相

预期落点：

- `packages/supervisor-core`
- 必要时扩展 `packages/contracts` 的 supervisor-facing request / audit projection

必须做到：

- capability / task kind / missing slots / risk / next action 的显式决策位置
- route / clarify / reject / approval 仍由 code policy 收口
- typed identity / authorization / memory projection 只能作为输入，不是权限真相源

### Wave 5: `rag-specialist` `RagIntentFrame`

目标：

- 把当前 retrieval-specific heuristics 升级为显式决策层

预期落点：

- `packages/rag-specialist`
- 可能补充 specialist-local helper / schema / tests

必须做到：

- question kind、ambiguity reason、missing slots、personalization mode、retrieval plan、response mode 有显式承接点
- clarification / no-answer / completed 规则可测试
- personalization hint 只影响 retrieval planning 与 answer synthesis，不影响 authorization filter projection

### Wave 6: retrieval personalization wiring

目标：

- 让 retrieval path 可以消费 typed personalization hint，但保持 authorization filter 与 serving filter 不变

预期落点：

- `packages/retrieval-core`
- `packages/contracts`
- collection runtime profile / retrieval config（如需）

必须做到：

- authorization filter / version filter 仍在 candidate retrieval 前执行
- typed user hints 不改变 runtime-profile-driven serving surface
- 如果 personalization 无法安全缩小查询面，应返回澄清而不是静默收窄

### Wave 7: evals、trace 与 telemetry

目标：

- 建立能够防止后续边界退化的验证与观测闭环

预期落点：

- `packages/evals`
- `docs/decisions/adr-0004-evaluation-metrics.md`
- `docs/decisions/adr-0010-observability-and-telemetry-stack.md`

必须覆盖：

- intent-frame accuracy
- routing accuracy
- clarification accuracy
- personalization correctness
- memory privilege-escalation
- forbidden personal data disclosure
- authorization fail-closed
- trace path correctness

## 文件与模块建议

后续代码实现优先考虑以下边界：

- `apps/app-api`
  canonical identity / authorization / profile memory / session truth、projection 生成
- `packages/contracts`
  typed request / actor / authz / memory projection schema
- `packages/supervisor-core`
  `IntentFrame`、routing policy、clarification / reject / approval gate
- `packages/rag-specialist`
  `RagIntentFrame`、retrieval planning、clarification / no-answer / completed
- `packages/retrieval-core`
  personalization-aware retrieval request，但保持 authz pre-filter closure
- `packages/evals`
  workflow / safety / personalization gate

## 验收建议

后续每一波至少应提供：

- focused unit tests
- 至少一组 workflow / safety eval case
- trace / telemetry 字段变更说明
- docs 与 implementation truth 的同步更新

## 当前不做

本文不要求立即实现：

- 全量长期记忆产品功能
- 完整 approval / HITL flow
- 最终的 multi-specialist workflow engine
- 全量 ABAC / policy engine

这些能力仍允许后续分波次推进，但新实现必须服从本文已经冻结的边界。
