---
doc_type: decision
decision_id: ADR-0030
status: accepted
created: 2026-04-06
updated: 2026-04-06
---

# ADR-0030 Institution-Scoped Product Path And Explicit Open-Domain Admission

## 状态

Accepted on 2026-04-06.

## 背景

`campus-agent` 当前已经在产品定位、prompt 约束和最近一轮拒答语义收口里明确了三件事：

- 它是 `institution-scoped campus assistant`
- 当前 campus path 不接受隐式 general web / world knowledge fallback
- `out_of_scope`、`policy_refusal`、`unsupported_by_evidence` 必须在产品语义、评测与可观测性上显式区分

但在完成 Domain-Bounded Answering And Refusal Foundation 的 Wave 1-5 之后，repo 仍缺一条更高层的正式决策：

- 未来是否要把开放域 generalist / web capability 接入主产品路径
- 如果以后真的要做，这件事应以什么边界进入，而不是偷渡成临时 fallback

如果这条决策不冻结，后续实现很容易退化为：

- 把 `out_of_scope` 重新解释成“先去 web 上试一下”
- 在 campus path 内引入 silent fallback，稀释当前 institution-scoped trust model
- 把开放域回答与校园受控回答混在同一条 policy / eval / operator 路径里
- 为了“更像通用助手”而绕开 `ADR-0006` 对 specialist 准入和安全边界的要求

## 决策

### 决策 1：当前主产品路径继续固定为 institution-scoped campus assistant

当前 repo 接受的主产品路径仍然只承接校园范围内、受控 serving surface 内的问题。

直接含义：

- `campus-agent` 当前不是开放域 general assistant
- 当前主路径不以“世界知识也可以顺手回答”为产品目标
- 产品扩展优先继续沿校园能力面推进，例如 campus service、place finding、navigation、identity-aware assistance

### 决策 2：campus path 内不允许隐式 general web / world fallback

当前 campus path 内不允许用 web search、world knowledge 或其他开放域能力去补齐域外问题。

直接含义：

- `MIT 的校长是谁` 这类问题应稳定落为 `out_of_scope`
- `out_of_scope` 不是一次失败后再尝试开放域补救的过渡态
- 不允许把开放域 fallback 伪装成“增强召回”“兜底问答”或“临时可用能力”

### 决策 3：Wave 1-5 收口出的拒答语义保持独立，不被未来 fallback 语义稀释

当前已建立的 `policy_refusal`、`out_of_scope`、`unsupported_by_evidence`、`restricted_access_denied` 语义继续保持独立。

直接含义：

- `out_of_scope` 仍表示产品边界外，而不是“域内证据不足”
- campus in-scope 问题仍必须先满足 scope、policy 和 grounding 约束
- operator / eval / publish 路径不得把开放域兜底结果混入当前 campus refusal semantics

### 决策 4：未来若要接受开放域能力，必须先做显式产品决策，再新增独立 capability boundary

只有当产品明确接受“开放域问答”成为正式能力面时，才允许讨论新的 open-domain capability。

直接含义：

- 这不是当前 target architecture 的既有组成部分
- 这不是当前 campus path 的隐含 backlog
- 它不能以“先接一个 web specialist 试试”的方式绕过产品决策

### 决策 5：未来开放域能力若被批准，必须以独立边界接入，而不是污染当前 campus path

如果未来确实接受开放域能力，至少需要同时满足以下准入条件：

- 独立 capability boundary 或 specialist boundary
- 显式 routing / admission 规则，区分 campus path 与 open-domain path
- 独立的 policy、prompt、grounding 与 refusal 语义
- 独立的 eval lane、release gate 与 operator observability 维度
- 明确的 serving surface / user expectation / disclosure 规则

禁止做法：

- 让 campus specialist 在失败时静默切到 web
- 把开放域 evidence 和 institution truth 放进同一个真实性承诺
- 因为存在 generalist 能力，就放松当前 campus path 的 fail-close 约束

### 决策 6：本 ADR 不引入任何新的开放域实现

本 ADR 只冻结产品与架构决策，不引入新的 web capability、generalist specialist 或开放域运行时路径。

## 结果

当前 repo 的正式结论固定为：

- `campus-agent` 现在不回答开放域问题
- 当前 campus path 不允许临时 web fallback
- 如果未来要增加开放域能力，必须单独立项、单独准入、单独评测和单独治理

## 关联文档

- `docs/architecture/product-positioning.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/prompt-and-instruction-architecture.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/architecture/prompt-and-instruction-architecture.md`
