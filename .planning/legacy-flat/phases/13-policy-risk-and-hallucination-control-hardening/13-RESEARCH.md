# Phase 13 Research: 政治风险判定与幻觉控制硬化

## External Findings

1. **政治高风险不等于“所有政治问题都拒答”**
   OpenAI Model Spec 把政治说服视为高风险场景，重点是避免模型参与操纵、定向影响、拉票、劝说等行为；这支持我们把校园 factual political/course 问题与 persuasion-style 请求明确拆开，而不是把“政治”直接映射成拒答。

2. **安全控制应是 layered defenses，而不是单点 prompt**
   OpenAI safety best practices 和 agent guidance 都强调：要把 moderation / guardrails、清晰的工具与权限边界、monitoring、human intervention、上线前 eval 组合起来使用。对本仓库来说，意味着 authoritative boundary 必须在 supervisor/rag/evals 代码里，而不是依赖一份 system prompt。

3. **幻觉控制的关键是鼓励 abstain，而不是奖励猜测**
   OpenAI 关于 hallucination 的公开说明明确指出，单纯优化“回答率”会鼓励模型在不确定时猜测；更合理的系统目标是让模型在证据不足时说不知道或拒绝补齐。这与 repo 当前 `unsupported_by_evidence` 的方向一致，应继续强化。

4. **eval 应覆盖真实失败模式，并设置可执行 gate**
   OpenAI eval best practices 强调 representative examples、明确 pass thresholds、以及把 eval 接入发布前回归。对本仓库，这意味着不能只做 generic `no_answer` case，而要把 `out_of_scope`、`policy_refusal`、`unsupported_by_evidence`、`grounded political/civic answer` 各自变成独立 regression lane。

5. **RAG hallucination guardrails 应面向“给定证据是否支持输出”**
   OpenAI Guardrails 的 hallucination detection 资料把问题表述为“输出是否被给定知识源支持”。这与我们的产品更匹配：幻觉控制不应是 open-ended truth oracle，而应是 bounded-evidence validator。

## Repo Implications

### 1. Policy / Scope / Grounding 必须显式三分

- `policy gate`
  判断是否触发平台或产品禁止事项，例如 targeted political persuasion / manipulation。
- `scope gate`
  判断问题是否属于 `institution-scoped campus assistant` 的产品边界。
- `grounding gate`
  判断当前 admitted 问题是否真的被 evidence bundle 支持。

这三层不能互相替代：

- 不能把 `MIT 的校长是谁` 写成 retrieval miss
- 不能把“习概有哪些专业要上”写成政治拒答
- 不能把 evidence-insufficient 的校园问题写成“模型尽力回答”

### 2. authoritative boundary 应留在 supervisor / specialist

- `apps/app-api` 最多做 request annotation 或 sink-side projection
- `packages/supervisor-core` 应拥有最终 policy/scope verdict
- `packages/rag-specialist` 应在 admitted path 内做 grounded generation + validator + downgrade

这与现有 repo 架构完全一致，不需要引入新的入口 agent 或 prompt-first safety 层。

### 3. hallucination control 应围绕 claim classes 扩展

当前 grounding validator 只覆盖：

- title claims
- time claims
- requirement claims

Phase 13 应优先补齐更贴近校园问答的高风险 claim：

- 课程归属 / 哪些专业要上
- 开课单位 / 学院归属
- 审批主体 / 审核主体
- 资格条件 / 限制条件
- 学分、学期、数量、频次等 structured facts

### 4. observability 需要区分“前置拒绝”和“后置降级”

运营侧最需要知道的是：

- 这是 `policy_refusal` 还是 `out_of_scope`
- 是 supervisor 直接拦截，还是 rag path 先进入后被 grounding validator 降级
- downgrade 的 unsupported fields 是什么

否则后续只会看到模糊 `no_answer`，无法定位真实问题。

## Recommended Phase Breakdown

### Plan 13-01

在 supervisor 侧完成 product-path verdict hardening：

- 收紧或替换 signal-only scope policy
- 明确 political-risk / persuasion policy classifier
- 统一 final semantic outcome 和 policy reasons

### Plan 13-02

在 rag-specialist 侧完成 grounding / unsupported hardening：

- 扩大 claim extraction taxonomy
- 强化 evidence-supported validator
- 在 unsupported 时 fail-close downgrade

### Plan 13-03

在 eval / observability 侧完成 closeout：

- 增补 golden cases、metrics、runtime diagnostics
- 让 app-api/operator 看到真实 refusal / downgrade source
- 把 Phase 13 接进 release gate

## Recommended Non-Goals

- 不把 Phase 13 做成“政治内容总开关”
- 不把 app-api 变成新的 policy engine
- 不把 hallucination control 写成 provider-specific SDK glue
- 不在这一 phase 里顺带开放 open-domain knowledge

## External References

- OpenAI Model Spec: https://model-spec.openai.com/2025-04-11.html
- OpenAI Safety Best Practices: https://platform.openai.com/docs/safety-best-practices
- OpenAI Agent Evals Guide: https://platform.openai.com/docs/guides/agent-evals
- OpenAI Guardrails Hallucination Detection: https://openai.github.io/openai-guardrails-python/ref/checks/hallucination_detection/
- OpenAI, Why language models hallucinate: https://openai.com/index/why-language-models-hallucinate
