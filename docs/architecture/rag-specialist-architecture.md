---
doc_type: architecture
status: active
created: 2026-03-28
updated: 2026-03-28
---

# RAG Specialist Architecture

## 文档边界

本文只冻结 `packages/rag-specialist` 的长期职责、内部决策分层、个性化输入边界与 ACL 约束。

本文不负责：

- retrieval backend、vector store、fusion 或 embedding baseline 的具体实现
- supervisor 的 top-level routing / approval policy
- app-layer auth/session/product UX
- 某一轮 prompt、阈值、query rewrite 模板或 provider 选型

对应 source of truth：

- repo 级长期边界：`long-term-architecture.md`
- supervisor 入口协调职责：`supervisor-architecture.md`
- retrieval runtime truth：`retrieval-query-strategy.md`
- 长期编排与安全边界：`../decisions/adr-0006-agent-orchestration-and-safety.md`
- identity / memory / personalization 分层：`../decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`

## 目标

这里要回答的问题只有五个：

- `rag-specialist` 长期到底拥有什么职责
- RAG 内部的“意图识别”应如何定义
- 个性化输入可以影响哪些环节
- 澄清、拒答与完成应在什么边界上发生
- ACL 与 untrusted data 边界如何保持不被 personalization 稀释

## 核心结论

`rag-specialist` 是 retrieval-oriented knowledge worker，不是顶层 router，也不是 retrieval-core 的薄包装。

长期上：

- supervisor 决定是否进入 knowledge specialist
- `rag-specialist` 决定 retrieval-specific intent framing、query planning、evidence collection、ambiguity handling 与 grounded answer synthesis
- retrieval-core 负责真正的 pre-filter、candidate retrieval 与 evidence shaping
- `app-api` 负责 canonical identity / memory ownership

## 长期职责

`rag-specialist` 应该拥有：

- retrieval-specific intent framing
- query rewrite / decomposition / expansion 的受控策略
- retrieval strategy selection
- evidence collection 与 normalization
- evidence-aware clarification / no-answer / completed 判定
- grounded answer synthesis

`rag-specialist` 不应该拥有：

- top-level capability routing
- canonical identity 或 profile memory ownership
- ACL / permission truth
- vector store、registry、object storage 的直接产品级耦合

## RagIntentFrame

长期上，`rag-specialist` 内部不应只靠零散 heuristics，而应存在一个稳定的 retrieval-specific `RagIntentFrame`。

字段名可以随实现演进，但语义至少应覆盖：

- `question_kind`
  例如 `fact`、`policy_basis`、`eligibility`、`procedure`、`materials`、`deadline`、`comparison`
- `personalization_mode`
  例如 `generic`、`cohort_grounded`、`user_grounded`
- `missing_slots`
  例如年级、专业、校区、项目名、奖项名、政策对象
- `ambiguity_reason`
  例如 `referential`、`missing_target`、`multi_policy`、`uncertain_profile`
- `retrieval_plan`
  例如 `exact_title_bias`、`table_bias`、`multi_query`、`rewrite_needed`
- `response_mode`
  例如 `clarify`、`retrieve_then_answer`、`no_answer`

这里冻结的是语义，不冻结具体 dataclass / JSON schema 名称。

## Retrieval Planning

`rag-specialist` 可以基于以下输入形成 retrieval plan：

- 用户原始问题
- supervisor 下发的 typed scope / capability 边界
- typed identity claims
- typed profile memory summary
- typed session summary
- runtime profile 提供的 collection-level serving constraints

允许的 planning 行为包括：

- query rewrite
- multi-query decomposition
- title / terminology bias
- table / structure-aware retrieval bias
- ambiguity-aware clarification

不允许的 planning 行为包括：

- 静默绕过 runtime-profile-driven serving scope
- 静默改写顶层 capability / specialist route
- 在 retrieval 之后再事后裁掉本应 pre-filter 拦下的受限内容

## Personalization Inputs

长期允许 `rag-specialist` 消费的个性化输入必须是 typed projection，而不是 raw product state。

允许的输入示例：

- `verified identity`
  例如 cohort、major、program、campus、role
- `profile memory summary`
  例如 recent goal、显式偏好、已确认长期背景
- `session summary`
  例如上一轮已确认的奖学金类型、当前正在比较的两个方案

这些输入可以影响：

- query rewrite 与 terminology choice
- candidate ranking bias
- clarification question 的优先顺序
- answer wording 中的默认前提说明

这些输入不能影响：

- ACL / campus_scope / group-based filtering
- runtime profile 中未开放 collection 的准入
- approval-required deterministic gate

## Clarification / No-Answer / Completed Policy

长期上，`rag-specialist` 至少保留三类稳定分支：

- `needs_clarification`
  当缺关键槽位、目标不明确、多个高相关政策并存、或 personalization 所依赖的 profile 不足以安全缩小检索面时触发
- `no_answer`
  当允许范围内没有足够证据，或证据支持度过低时触发
- `completed`
  只有当 evidence 足以支撑 answer claim 时才触发

补充规则：

- 如果 personalization hint 与 evidence 或 verified identity 冲突，优先澄清而不是静默猜测
- 如果 personalization hint 过旧或置信度不足，应显式说明“按当前记录理解”或先请求确认
- 不允许仅凭 personalization 将 generic query 强行收窄到单一政策对象而不暴露该假设

## ACL And Untrusted Data Boundary

长期硬约束如下：

- ACL 由 code path 强制执行，不由模型决定
- retrieval pre-filter 必须先于 candidate retrieval 生效
- personal memory 不能绕过 `acl_level`、`acl_groups`、`campus_scope`、`current_only` 或版本过滤
- retrieval 返回的文本仍然是 `untrusted data`

这意味着：

- `rag-specialist` 可以基于 evidence 做解释和综合
- 但不能把 evidence 当作新的 routing / permission truth
- 也不能让自由文本输出越过 deterministic gate 执行高风险动作

## 与其他边界的关系

与 `supervisor`：

- supervisor 决定是否进入 `rag-specialist`
- `rag-specialist` 不反向接管 top-level intent framing
- `rag-specialist` 返回 typed status、confidence 与 evidence，而不是直接拥有最终产品 response truth

与 `retrieval-core`：

- `rag-specialist` 通过 retrieval abstraction 获取 evidence
- retrieval-core 负责 pre-filter、candidate retrieval 与 evidence shaping
- `rag-specialist` 不应理解 backend-specific payload / client types

与 `app-api`：

- `app-api` 拥有 canonical identity、profile memory 与 session truth
- `rag-specialist` 只消费最小化 typed projection
- `rag-specialist` 不直接连接产品层 auth/session/memory 存储

## 非目标

本文不冻结：

- 某种 prompt 模板
- 某个模型是否启用 `HyDE`
- 某次迭代的 rerank / rewrite 阈值
- 某个 collection 的具体 personalization 策略
- 某轮实现到底用 rule、structured output 还是两者混合承载 `RagIntentFrame`

这些内容应进入后续实现、plan、eval 或 runtime configuration，而不是写死在长期边界文档中。
