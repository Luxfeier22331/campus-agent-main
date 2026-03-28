---
doc_type: decision
decision_id: ADR-0006
status: accepted
created: 2026-03-25
updated: 2026-03-28
---

# ADR-0006 编排模式与安全边界

适用范围：`campus-agent` v2 的长期 supervisor-led orchestration、specialist 扩展方式，以及跨边界安全控制

## 目标

在不推翻既有 package boundary 的前提下，冻结 `campus-agent` 的长期编排模式更新，明确：

- 哪些编排模式是长期允许的
- 何时应该新增 specialist，何时不应该
- 不可信数据在多 agent / 多 capability 系统中如何隔离
- approval / HITL、trace 与 release gate 应处在什么边界上

## 非目标

本 ADR 不冻结以下内容：

- phase-1 当前运行时选型
- 某个 agent runtime、SDK 或 orchestration 框架的具体 API 用法
- 某个 specialist 的 prompt、tool 列表或具体实现
- 某次迭代的 workflow 细节、阈值或上线节奏
- retrieval backend、vector store 或 object storage 的具体产品更换计划

这些内容应分别进入 phase ADR、实施计划、运行时配置或后续代码设计，而不是写死在长期编排规则中。

## 决策 1：长期采用 Hybrid Orchestration

`campus-agent` 的长期编排采用 `hybrid orchestration`，而不是把所有控制都交给 LLM，也不是把所有行为预先冻结成声明式大图。

边界固定如下：

- `code orchestration`
  负责 auth、ACL / policy gate、approval hook、timeout / retry、deterministic stop condition、结构化输入输出校验、审计与 trace 投影
- `LLM orchestration`
  负责意图框定、开放式任务拆解、query rewriting、evidence synthesis、clarification / refusal wording 与其他非确定性推理

长期约束：

- 安全边界、权限边界和不可逆动作的门禁优先由 code orchestration 承担
- LLM 可以参与决策建议，但不应独占高风险控制权
- 不将整个系统冻结成一次性 declarative graph / DSL 作为唯一编排真相源

## 决策 2：Manager-Managed Specialist 与 Explicit Handoff 可以并存

长期允许两类编排模式并存：

- `manager-managed specialist`
  supervisor 保持顶层控制，向 specialist 委派受限子任务
- `explicit handoff`
  在确有必要时，把后续一个或多个回合的主导权显式交给 specialist

长期默认规则：

- 顶层产品路径默认由 supervisor 保持控制
- bounded subtask 优先采用 `manager-managed specialist`
- 只有当 specialist 需要拥有后续回合、独立状态或独立交互上下文时，才采用 `explicit handoff`
- 两类模式都必须通过 `packages/contracts` 中冻结的 delegation / handoff contract 交互

禁止退化为：

- 把顶层产品路径重新做回扁平 tool bundle
- 让 specialist 在没有显式 contract 和 routing 的前提下彼此自由串联
- 演化成没有全局策略拥有者的无中心 peer mesh

## 决策 3：新增 Specialist 必须满足准入规则

新增 specialist 不是默认优化项，必须满足清晰的架构理由。

长期准入条件至少包括：

- 它拥有稳定、可重复、可命名的单一职责边界
- 它对应独立的 downstream capability、tool / permission boundary 或状态边界
- 把该能力继续塞在现有 supervisor 或现有 specialist 内，已经造成 prompt / context / tool overload 或边界混乱
- `packages/evals` 中已有足够证据表明拆分能提升质量、可观测性或安全性

如果这些条件不成立，则默认：

- 继续留在现有 specialist 内部实现
- 或留在 supervisor 的 policy / orchestration 层

而不是为了“看起来更 agentic”而增加新 specialist。

## 决策 4：检索结果、网页内容与第三方返回统一视为 Untrusted Data

以下输入默认都属于 `untrusted data`：

- retrieval 返回的文档片段
- OCR / parser 产物
- 网页文本与外部站点响应
- 第三方 API 返回
- 用户上传文件及其提取文本

长期边界固定如下：

- `untrusted data` 不得直接写回 developer / system 指令层
- `untrusted data` 不得以自由文本形式直接驱动 routing、tool permission 或 handoff 决策
- 节点之间的关键控制信号必须通过结构化 schema 和显式字段传递
- 如需基于不可信内容触发后续动作，必须经过 code orchestration 的显式校验和 policy gate

## 决策 5：Approval / HITL 是长期保留的系统边界

`campus-agent` 不要求第一阶段一次做满完整 approval / HITL，但长期架构必须保留这条边界。

长期规则如下：

- 涉及不可逆 side effect、跨系统写入、权限变更、外部官方动作或高风险对外操作时，必须允许 approval / HITL 介入
- specialist 自由文本输出不能直接越过 deterministic gate 触发高风险动作
- 即使当前阶段只保留 approval hook，也不能把这条边界从架构上删除

## 决策 6：编排变更进入 Release Path 前必须通过 Trace / Eval Gate

以下变化在进入正式 release gate 前，必须先在 `packages/evals` 中具备可重复验证：

- 新 specialist
- 新 routing rule
- 新 handoff 路径
- 新 approval-required capability

至少需要覆盖：

- workflow truth
- safety / gate truth
- trace-level observability

缺少这些验证时，不允许把相关变化视为“已经成为稳定架构的一部分”。

## 决策 7：文档分层关系

- `docs/architecture/long-term-architecture.md`
  负责长期编排边界、角色分工与系统形态
- `docs/architecture/supervisor-architecture.md`
  负责 supervisor 如何承接这些长期规则，以及当前 execution engine runtime / Agno 集成边界
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
  负责 identity / memory / personalization 如何作为 typed context 进入编排，而不稀释 ACL 或权限边界
- `docs/architecture/phase1-ingestion-and-storage-architecture.md`
  负责 phase-1 数据平面约束，以及对象存储 + registry + Qdrant 组合理由
- 本 ADR
  负责长期编排模式、specialist 准入与安全边界
- `docs/decisions/adr-0004-evaluation-metrics.md`
  负责与编排变更相关的 workflow / safety / gate 指标语义
- `docs/plans/`
  负责某一轮文档刷新或实现落地的任务分解、文件落点和验收标准

换句话说，本文回答“长期允许什么样的编排与安全边界”，而不是“这轮代码怎么改”。
