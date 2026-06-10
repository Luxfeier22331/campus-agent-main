---
doc_type: decision
decision_id: ADR-0015
status: accepted
created: 2026-03-28
updated: 2026-06-10
---
# ADR-0015 用户身份、长期记忆与个性化边界

## 状态

Accepted on 2026-03-28.

Memory ownership / online recall / confirmation-flow 条款已由
`ADR-0049 Qdrant-Native Personal Memory Index` 局部 supersede。本文的 canonical identity、
authz 最小化、raw state 不跨边界、个人 memory 不进入 institutional index 等约束继续生效。

## 背景

`campus-agent` 的长期产品形态不再只是“匿名问题 -> handbook RAG”。

后续 public chat 与 protected surface 都可能逐步携带：

- canonical app identity
- 持久化的用户 profile / preference / goal memory
- 当前会话摘要与上下文
- 面向个人背景的个性化问答

如果这些能力不先冻结边界，后续实现很容易退化为：

- 把 Worker / edge 侧身份材料误当成最终 actor truth
- 把“用户曾经说过的话”直接当成已验证身份
- 让 profile memory 直接扩大 ACL、query scope 或 approval 权限
- 把 institutional knowledge 与个人记忆塞进同一 retrieval truth store
- 让 `supervisor` / `knowledge` 跨边界直接读取 raw auth、raw memory 或 raw conversation
  state

因此这里要先固定：身份、长期记忆、会话记忆、个性化与授权边界到底分别属于哪一层，并且哪些能力以后不允许再摇摆。

## 决策 1：canonical identity 由 `app-api` 拥有

长期上：

- canonical app identity 由 `apps/app-api` 拥有
- browser cookie、Access JWT、Worker admission 或 edge trust material 只属于
  runtime-boundary input
- `apps/execution-control`、`apps/supervisor-agent-worker`、
  `packages/knowledge-capability` 只消费 `app-api` 投影后的 typed actor
  context

这意味着：

- Worker / edge 侧验证通过，不等于最终 `SupervisorRequest.actor` 已经成立
- canonical actor claims 必须在 app-layer boundary 内完成映射、裁剪与版本化
- execution engine 不反向拥有产品层 identity truth

## 决策 2：用户上下文固定拆成四层真相

长期上，回答链路相关的用户上下文固定拆成以下四层：

- `verified identity` 由 canonical account / identity truth 支撑的已验证 claims，例如
  cohort、major、program、campus、role
- `profile memory` 用户长期偏好、稳定目标、显式声明且允许持久化的背景信息，例如“最近在咨询保研”“偏好先看官方条文”
- `session memory` 当前会话内的短期工作记忆、摘要、已确认槽位和上下文承接
- `institutional knowledge` 校园制度、培养方案、官网内容等机构知识真相

四层语义固定如下：

- `verified identity` 是 policy / applicability 可消费的强 truth
- `profile memory` 是 personalization 可消费的弱 truth
- `session memory` 是对话连续性所需的短期 truth
- `institutional knowledge` 是回答事实依据的主真相源

## 决策 3：memory 不得伪造 identity / restricted entitlement

ADR-0049 允许 memory 影响 routing、admission、applicability、query rewrite 与默认假设。
本文继续冻结以下硬约束：

- 未经验证的用户自述、模型推断、session summary 或 inferred memory 不得升级为 authorization truth

允许的影响范围：

- query rewrite
- ranking / disambiguation bias
- routing / admission / applicability signal
- clarification wording 与顺序
- answer wording、默认假设和 follow-up 提示

不允许的影响范围：

- authorization filter projection，包括受限文档 retrieval 的 `visibility_*` /
  `entitlement_*` projection
- runtime-profile-driven serving surface
- restricted approval-required capability 的 deterministic gate
- 跨 corpus 放开或未开放 collection 的静默路由

完整 authorization model、retrieval filter projection 与 `visibility` /
`applicability` 拆分由 `ADR-0034` 单独定义；本文只冻结 memory 不得伪造
identity、restricted entitlement 或 restricted document access 这条长期边界。是否影响普通
capability routing / applicability / query rewrite 由后续 memory ADR 决定。

## 决策 4：跨边界只传 typed projection，不传 raw state

`app-api -> execution-control -> agent` 链路默认只允许传递最小化、结构化的上下文投影。

长期默认允许的内容包括：

- actor id 或 stable principal id
- authorization snapshot id、ownership / approval summary 或等价的最小 authz projection
- role / group / campus / cohort / major 等 typed claims
- bounded memory recall packet / compact memory refs
- memory source type / score / staleness summary
- session summary / confirmed slots

长期默认不允许跨边界直传：

- raw JWT、raw auth headers、raw cookie、raw access envelope
- raw long-term memory 文本
- 未经裁剪的完整 conversation transcript
- 产品层数据库对象或 provider-specific identity payload

## 决策 5：机构知识与个人记忆不得共用 canonical retrieval truth store

长期上：

- institutional knowledge 继续位于 document registry、chunk metadata 与 vector index
  所表达的 retrieval truth store
- verified identity / profile memory 属于 app-layer profile truth store
- session memory 属于 chat/session truth store

因此：

- 不把个人记忆写进机构知识索引
- 不把用户 profile 当作 `packages/retrieval-core` 的 canonical source truth
- 机构知识与个人记忆的 join 发生在 orchestration / request projection 层，而不是索引层

## 决策 6：personal memory 只能作为 typed execution context

长期允许 planning、RAG 与 deterministic tools 消费以下类型的 memory context：

- verified identity claims
- bounded Qdrant personal memory recall items
- session-level confirmed slots

但长期不允许：

- 让 `supervisor` 或 `knowledge` 直接拥有 canonical identity store
- 让 `app-api` chat hot path 全量读取 PG profile memory 并注入 prompt
- 让模型自行从 raw conversation 中提权式推断“用户应当拥有的权限”

## 决策 7：个性化相关观测必须数据最小化

长期允许追踪的最小治理字段包括：

- `actor_id_hash`
- actor claims version / snapshot id
- personalization mode
- memory item id / hash
- memory source type
- clarification reason
- ACL filter summary

长期默认不允许落盘：

- raw profile memory
- raw private notes
- 未脱敏的 personal conversation text
- raw auth material

## 决策 8：文档分层关系

- `docs/architecture/target-architecture.md` 负责 repo 级 identity / memory /
  knowledge truth 分层
- `docs/architecture/system/identity-and-authorization-architecture.md` 负责 canonical
  authz truth、retrieval filter projection 与 visibility / applicability 分层
- `docs/architecture/system/memory-plane-architecture.md` 负责 Qdrant-native Personal
  Memory Plane、`memory.recall` runtime 消费链路与 Temporal 参与点
- `docs/architecture/system/product-runtime-architecture.md` 负责 canonical
  identity、authorization 与 memory ownership 所在的 app boundary
- `docs/architecture/system/execution-and-agents-architecture.md`
  负责 supervisor 如何消费 typed identity / authorization / memory
  projection
- `docs/architecture/system/execution-and-agents-architecture.md` 负责 retrieval-specific
  personalization 与 `RagIntentFrame`
- `docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`
  负责长期 authorization model 与 retrieval filter projection 决策
- `docs/decisions/adr-0049-qdrant-native-personal-memory-index.md`
  负责 personal memory online recall truth、Qdrant collection 与 ADR-0015 memory 旧口径替代
- `docs/decisions/adr-0010-observability-and-telemetry-stack.md` 负责 identity /
  memory telemetry 的最小化规则
- `docs/decisions/adr-0004-evaluation-metrics.md` 负责 personalization / memory /
  authorization 相关 gate 指标
- `.planning/WORKSTREAMS.md` 与 `GSD SDK / Codex native session state` 负责某一轮
  identity / authorization / memory / personalization 实现波次、文件落点与验收标准

## 结果

直接结果如下：

- 后续 identity / authorization 能力必须以 `app-api` 为 canonical owner；online memory recall
  以 ADR-0049 的 Qdrant-native Personal Memory Index 为准
- `supervisor` 负责 top-level intent framing 时可以参考 typed personal context，但不能把
  personal context 当作权限源
- `knowledge` 可以利用 typed personal context 优化 retrieval-specific planning，但不能绕过
  retrieval pre-filter
- retrieval 与 workflow path 消费的 authz 语义必须来自 app-layer projection，而不是 raw token
  claims 或 memory 推断
- memory 系统与 RAG 系统的 join 点必须数据最小化；online path 消费 bounded
  `memory.recall` packet，不建设 v1 强审计图谱

## 相关文档

- `docs/architecture/target-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0010-observability-and-telemetry-stack.md`
- `docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`
- `docs/decisions/adr-0049-qdrant-native-personal-memory-index.md`
