---
doc_type: plan
status: active
created: 2026-03-28
updated: 2026-03-28
---

# Intent / Memory / ACL Foundation

## 文档边界

本文只负责把长期设计讨论拆成后续可执行的实现波次、文件落点和验收标准。

本文不负责：

- 重新定义长期边界真相
- 宣布当前阶段已经完成哪些实现
- 冻结具体 prompt、阈值、模型或 provider

对应 source of truth：

- 长期边界：`docs/architecture/long-term-architecture.md`
- supervisor 长期职责：`docs/architecture/supervisor-architecture.md`
- rag specialist 长期职责：`docs/architecture/rag-specialist-architecture.md`
- app-layer identity / memory ownership：`docs/architecture/app-api-architecture.md`
- 编排与安全边界：`docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- identity / memory / personalization 决策：`docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`

## 目标

后续实现要把以下长期设计真正落到代码：

- supervisor 具备 typed `IntentFrame`
- `rag-specialist` 具备 retrieval-specific `RagIntentFrame`
- `app-api` 成为 canonical identity / memory owner
- personalization 进入 answer path，但不稀释 ACL
- evals、trace 和 telemetry 可以验证这些边界没有退化

## 完成定义

这轮基础工作完成时，至少应满足：

1. `app-api` 可以输出 canonical actor claims 与最小化 typed memory projection。
2. `supervisor` 不再把 top-level intent 识别等价为“入口已给定 scope”。
3. `rag-specialist` 具备显式的 retrieval-specific intent / clarification / personalization 决策位置。
4. retrieval personalization 只能影响 query planning、clarification 与 answer wording，不能扩大 ACL。
5. `packages/evals` 能对 intent / routing / clarification / memory / ACL path 提供可重复验证。
6. telemetry / audit 可以追踪 identity / memory projection 的最小治理字段，而不落 raw sensitive data。

## 波次拆分

### Wave 1: 文档与 contract 草案冻结

目标：

- 冻结 `IntentFrame`、`RagIntentFrame`、identity / memory truth layering、personalization 边界

文件落点：

- `docs/architecture/long-term-architecture.md`
- `docs/architecture/supervisor-architecture.md`
- `docs/architecture/rag-specialist-architecture.md`
- `docs/architecture/app-api-architecture.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`

验收：

- 边界、ownership、forbidden shape 与文档分层关系无冲突
- docs index 已收录新增 canonical docs

### Wave 2: `app-api` identity / memory projection

目标：

- 在 `app-api` 内建立 canonical actor 与 typed memory projection 的最小实现面

预期落点：

- `apps/app-api` auth / profile / chat / runtime-command 相关模块
- 可能需要扩展 `packages/contracts` 中的 actor / request projection schema

必须做到：

- verified identity、profile memory、session memory 分层
- typed projection 默认不含 raw JWT、raw transcript、raw long-term memory
- projection 带 source / confidence / staleness / visibility 语义

### Wave 3: supervisor `IntentFrame`

目标：

- 让 top-level intent framing 不再依赖入口预填 scope 作为唯一真相

预期落点：

- `packages/supervisor-core`
- 必要时扩展 `packages/contracts` 的 supervisor-facing request / audit projection

必须做到：

- capability / task kind / missing slots / risk / next action 的显式决策位置
- route / clarify / reject / approval 仍由 code policy 收口
- typed identity / memory projection 只能作为输入，不是权限真相源

### Wave 4: `rag-specialist` `RagIntentFrame`

目标：

- 把当前 retrieval-specific heuristics 升级为显式决策层

预期落点：

- `packages/rag-specialist`
- 可能补充 specialist-local helper / schema / tests

必须做到：

- question kind、ambiguity reason、missing slots、personalization mode、retrieval plan、response mode 有显式承接点
- clarification / no-answer / completed 规则可测试
- personalization hint 只影响 retrieval planning 与 answer synthesis

### Wave 5: retrieval personalization wiring

目标：

- 让 retrieval path 可以消费 typed personalization hint，但保持 ACL 与 serving filter 不变

预期落点：

- `packages/retrieval-core`
- `packages/contracts`
- collection runtime profile / retrieval config（如需）

必须做到：

- `acl_level` / `acl_groups` / `campus_scope` / version filter 仍在 candidate retrieval 前执行
- typed user hints 不改变 runtime-profile-driven serving surface
- 如果 personalization 无法安全缩小查询面，应返回澄清而不是静默收窄

### Wave 6: evals、trace 与 telemetry

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
- ACL fail-closed
- trace path correctness

## 文件与模块建议

后续代码实现优先考虑以下边界：

- `apps/app-api`
  canonical identity / profile memory / session truth、projection 生成
- `packages/contracts`
  typed request / actor / memory projection schema
- `packages/supervisor-core`
  `IntentFrame`、routing policy、clarification / reject / approval gate
- `packages/rag-specialist`
  `RagIntentFrame`、retrieval planning、clarification / no-answer / completed
- `packages/retrieval-core`
  personalization-aware retrieval request，但保持 ACL pre-filter closure
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
