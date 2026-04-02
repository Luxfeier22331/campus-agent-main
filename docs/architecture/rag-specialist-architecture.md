---
doc_type: architecture
status: active
created: 2026-03-28
updated: 2026-04-02
---

# RAG Specialist Architecture

## 文档边界

本文只冻结 `packages/rag-specialist` 的长期职责、内部决策分层、个性化输入边界与 authorization filter 约束。

本文不负责：

- retrieval backend、vector store、fusion 或 embedding baseline 的具体实现
- supervisor 的 top-level routing / approval policy
- app-layer auth/session/product UX
- 某一轮 prompt、阈值、query rewrite 模板或 provider 选型

对应 source of truth：

- repo 级长期边界：`long-term-architecture.md`
- supervisor 入口协调职责：`supervisor-architecture.md`
- authorization / access-control 长期边界：`authorization-and-access-control-architecture.md`
- retrieval runtime truth：`retrieval-query-strategy.md`
- 长期编排与安全边界：`../decisions/adr-0006-agent-orchestration-and-safety.md`
- identity / memory / personalization 分层：`../decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- 授权模型与 retrieval filter projection：`../decisions/adr-0016-authorization-model-and-retrieval-filter-projection.md`

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
- `app-api` 负责 canonical identity / authorization / memory ownership

## 长期职责

`rag-specialist` 应该拥有：

- retrieval-specific intent framing
- query rewrite / decomposition / expansion 的受控策略
- retrieval strategy selection
- evidence collection 与 normalization
- evidence-aware clarification / no-answer / completed 判定
- grounded answer synthesis
- intent-aware answer shaping；至少允许 `procedure`、`deadline/time`、`generic` 这类稳定 response mode 对回答合同施加不同约束

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

当前 `student_handbook` 已落地一条 collection-specific policy-object lane：

- `rag-specialist` 负责基于 repo-tracked alias/title config 做保守制度对象解析
- 若制度对象缺失或仍存在多个候选，必须在 retrieval 前返回 `needs_clarification`
- 若制度对象已唯一解析，则把目标 `document_id` 作为受控 retrieval planning 输入交给 `retrieval-core`
- 若目标制度内没有足够支撑证据，则返回对象内 `no_answer`，而不是借用相邻制度补答
- operator-facing summary diagnostics 只作为 `app-api` request projection 的下游消费物，不属于 `rag-specialist` 对 panel 的直接 contract

已记录但尚未落地的下一条同类 lane 是 `curriculum/curriculum_plan` 的 program-family ambiguity hardening：

- `rag-specialist` 将基于 repo-tracked MUC curriculum alias governance config 进行 resolve / bias / clarify 规划
- family alias（例如 `基地班`、`实验班`、`创新班`、`民族班`）默认不作为单一培养方案 truth，而是先生成候选并决定是否澄清
- 若 query 自身已足够明确，或 `verified identity` 只在 deictic query 下把 active candidates 收窄到唯一 doc，则 specialist 可以把 resolved `document_id` 下发给 `retrieval-core`
- 若 personalization 只提供弱 prior，则 specialist 只能把它用于 candidate ranking bias 或 clarification 候选排序，不得静默硬解析
- curriculum 的 operator-facing diagnostics 也应复用这一 resolution/clarification 语义，而不是继续复用 handbook-only 的命名心智

对更长期的 institution-scoped entity alias 治理，进一步冻结如下：

- `rag-specialist` 解析的长期对象应是 canonical entity，而不是单纯 rewritten query text
- specialist 当前可接受的 alias tier 只是第一版实现载体；长期语义上至少应区分：
  - `safe_alias`
  - `family_alias`
  - `scoped_alias`
  - `deprecated_alias`
  - `pattern_alias`
  - `forbidden_alias`
- specialist 当前可接受的 entity type 至少包括：
  - `course`
  - `course_family`
  - `program`
  - `semester`
  - `cohort`
- specialist 当前可接受的 resolution 终态至少包括：
  - `resolved_single`
  - `resolved_family`
  - `needs_clarification`
  - `rejected`

对中央民族大学课程域，当前 accepted institution-scoped truth 包括：

- `习概 -> 习近平新时代中国特色社会主义思想概论`
  作为 `safe_alias`
- `思政课 -> 思想政治理论课`
  作为 `family_alias`
- `思修课 -> 思想政治理论课`
  作为 `family_alias`

这里进一步冻结：

- `思修课` 在本项目中不是单课 alias
- `思修课` 也不是 repo-wide 通用词义
- `思修课` 只能在中央民族大学课程域、且命中允许的 course-family intent 时生效
- family alias 不得静默坍缩为单一课程；除非 query wording 已显式指向某个成员，否则正确终态应是 `resolved_family` 或 `needs_clarification`

## Answer Shaping

长期上，`rag-specialist` 的 retrieval-specific intent 不只作用于 query planning，也作用于 answer shaping contract。

当前应固定的最小规则：

- `procedure` 类问句优先输出“先做什么 -> 再做什么 -> 去哪里/由谁审批 -> 时间窗口”
- `deadline/time` 类问句优先输出时间、频率、适用例外，而不是展开无关背景
- `generic` 类问句可以继续沿 grounded synthesis 输出

对课程型 query，当前进一步接受一条 entity-aware answer shaping contract：

- 当 canonical truth 是单一课程时，可以直接回答该课程的 audience / cohort / semester 等已采集字段
- 当 canonical truth 是课程 family 时，回答必须按 family 语义生成，而不是伪装成单课答案
- 当问题同时包含当前已支持字段和当前未采集字段时，允许 partial answer
- partial answer 必须显式标注 unsupported subfield，而不是由模型补猜

示例：

- `习概有哪些专业要上`
  可落到单一课程 audience/cohort truth
- `思政课有哪些专业要上`
  应先落到 `course_family`，再按 family audience 语义回答
- `思政课是哪个学院开的`
  若 `offering_unit` truth 尚未采集，应返回 unsupported-subfield 或 partial answer，而不是猜测学院

附加约束：

- `procedure` 主答案应优先保留 action path，不应让 side note 抢占首句
- 例如优惠卡、处分、解释权、再次补发限制等信息默认属于 side note，而不是 “怎么办” 的主线答案
- citation contract 可以因 answer mode 不同而不同，但必须保持 grounded 且可回链

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

- authorization filter projection，包括当前过渡期 `acl_level` / `acl_groups` / `campus_scope` 与后续 `visibility_*` / `entitlement_*` payload
- runtime profile 中未开放 collection 的准入
- approval-required deterministic gate

对 curriculum ambiguity lane，进一步冻结以下姿态：

- `verified identity` 可作为 stronger hint，但仍不是自动授权或自动 doc truth
- `profile memory` 和 `recent_goal` 只能作为 weaker hint
- `基地班` 这类 family alias 不得仅凭用户长期记忆直接落到某一培养方案
- 如果 personalization 不能把候选安全收敛到唯一 doc，正确行为仍是 `needs_clarification`

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

## Authorization Filter And Untrusted Data Boundary

长期硬约束如下：

- authorization filter projection 由 code path 强制执行，不由模型决定
- retrieval pre-filter 必须先于 candidate retrieval 生效
- personal memory 不能绕过 authorized visibility filter、`current_only`、版本过滤或 serving surface gate
- 当前 phase-1 的 `acl_level`、`acl_groups` 与 `campus_scope` 只属于 transitional filter fields；长期 retrieval payload 词汇应收敛到 `visibility_*` / `entitlement_*` projection，而不是 canonical authz truth
- retrieval 返回的文本仍然是 `untrusted data`

这意味着：

- `rag-specialist` 可以基于 evidence 做解释和综合
- `rag-specialist` 可以请求更精细的澄清或更保守的 query planning，但不能扩大 visibility
- 但不能把 evidence 当作新的 routing / permission truth
- 也不能把 applicability / personalization 假设伪装成 permission truth
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

- `app-api` 拥有 canonical identity、authorization、profile memory 与 session truth
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
