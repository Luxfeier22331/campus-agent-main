# Phase 13: 政治风险判定与幻觉控制硬化 - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning
**Source:** Existing prompt/supervisor/rag/eval architecture, current repo code truth, and external safety/eval guidance

<domain>
## Phase Boundary

Phase 13 closes a product-path hardening gap that is already visible in the repo:

- `campus-agent` 已经明确区分 `policy_refusal`、`out_of_scope`、`unsupported_by_evidence`、`restricted_access_denied`
- 但当前 runtime 仍存在明显的 heuristic / partial implementation gap
- 特别是 supervisor 的 scope 判断还偏向 signal 匹配，RAG grounding validator 仍只覆盖少数 claim 类型，eval/observability 也还没有专门针对“政治风险 + 幻觉控制”形成一条硬化闭环

### In Scope

- 冻结并实现 `policy gate -> scope gate -> grounding gate` 的代码拥有边界
- 明确政治相关请求在产品路径上的分类语义，而不是继续依赖 topic keyword
- 为 promptified answer path 增加更严格的 grounded / unsupported downgrade contract
- 为 `policy_refusal`、`out_of_scope`、`unsupported_by_evidence` 增补 eval 与 observability 证据面

### Out Of Scope

- 把产品默认扩成 open-domain assistant
- 隐式引入 general web fallback 或开放校园外世界知识问答
- 把 prompt 变成最终安全边界
- 新建人工审核后台或完整 trust-and-safety ops system

### Success Shape

- 校园范围内、证据充分的政治/思政/课程类问题可以正常回答
- 校园范围外的问题稳定落到 `out_of_scope`
- 明确违规的政治操纵/定向说服类请求稳定落到 `policy_refusal`
- 校园范围内但证据不足的问题稳定落到 `unsupported_by_evidence`
- 上述分流在 supervisor trace、app-api projection、eval metrics 中都能被明确区分
</domain>

<decisions>
## Implementation Decisions

### Locked by accepted architecture

- `campus-agent` 长期是 `institution-scoped campus assistant`，不是默认开放域助手。
- “政治”不是一个足以直接触发拒答的实现标签；政治话题本身不等于 `policy_refusal`。
- `policy_refusal`、`out_of_scope`、`unsupported_by_evidence`、`restricted_access_denied` 必须继续保持分离。
- prompt 只负责 wording / reasoning compression，不拥有 policy / scope / grounding 真相。

### Locked by current code truth

- `packages/supervisor-core/src/campus_supervisor_core/scope_policy.py` 当前主要用 campus / external / world signals 做 scope 判定；这是当前 Phase 13 要替换或收紧的首个脆弱点。
- `packages/supervisor-core/src/campus_supervisor_core/policy.py` 已经把 `out_of_scope`、`approval_required`、`policy_refusal` finalization 拆开；Phase 13 不应回退成一个模糊 `no_answer` 桶。
- `packages/rag-specialist/src/campus_rag_specialist/grounding_validation.py` 当前只检查标题、时间、要求类 claim；它不足以承担完整 hallucination control。
- `packages/evals/src/campus_evals/expectations.py` 已经具备 `out_of_scope_accuracy`、`policy_refusal_accuracy`、`unsupported_abstention_accuracy` 等 metric seam；Phase 13 应扩面，而不是另起一套评测口径。

### Locked by external guidance

- 政治高风险处理应聚焦在 persuasion / manipulation / targeted influence，而不是泛化成“所有政治问题都拒答”。
- 幻觉控制不应只靠 prompt 提醒；应使用 layered defenses、representative evals、以及在证据不足时明确 abstain。
- 对 agent / RAG 产品，input guardrail、runtime gate、output validation、monitoring/evals 应作为组合，而不是互相替代。

### Ownership

- `apps/app-api`
  只能拥有 product-facing outcome mapping、projection、telemetry sink；不得拥有最终 policy/scope 判定真相。
- `packages/supervisor-core`
  是 `policy gate` 与 `scope gate` 的 authoritative owner。
- `packages/rag-specialist`
  只处理已 admitted 的 in-scope knowledge path，负责 grounding / unsupported downgrade。
- `packages/evals`
  拥有回归 truth、golden cases、runtime observability grading。
- prompt family
  只消费上游 verdict，不能重新解释 verdict。

### The agent's discretion

- 是否把 app-api 上游 moderation 做成 blocking precheck，还是先做 best-effort annotation，再由 supervisor 作为 authoritative gate
- 是否为 Phase 13 引入更细的 `policy_reason` / `unsupported_fields` taxonomy
- claim validator 的精细粒度应先覆盖哪些高风险字段（课程归属、流程条件、时间约束、权限/审批、restriction wording）
</decisions>

<canonical_refs>
## Canonical References

**Repo truth**

- `docs/architecture/prompt-and-instruction-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/decisions/adr-0030-institution-scoped-product-path-and-explicit-open-domain-admission.md`
- `packages/supervisor-core/src/campus_supervisor_core/scope_policy.py`
- `packages/supervisor-core/src/campus_supervisor_core/policy.py`
- `packages/rag-specialist/src/campus_rag_specialist/grounding_validation.py`
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- `packages/evals/src/campus_evals/expectations.py`
- `packages/evals/src/campus_evals/operator_observability.py`
- `packages/shared/src/campus_shared/prompt_runtime.py`
- `apps/app-api/src/modules/request-observability.ts`

**External guidance**

- `https://model-spec.openai.com/2025-04-11.html`
- `https://platform.openai.com/docs/safety-best-practices`
- `https://platform.openai.com/docs/guides/agent-evals`
- `https://openai.github.io/openai-guardrails-python/ref/checks/hallucination_detection/`
- `https://openai.com/index/why-language-models-hallucinate`
</canonical_refs>

<specifics>
## Specific Ideas

- `MIT 的校长是谁`
  应走 `out_of_scope`，而不是 campus retrieval miss。
- `习近平新时代中国特色社会主义思想概论有哪些专业要上`
  如果当前 curriculum evidence 足够，应允许回答，而不是因为话题带有政治色彩自动拒答。
- 面向特定人群的政治劝说、拉票、定向影响请求
  应走 `policy_refusal`。
- 如果某个校园问题本身在范围内，但证据里找不到支撑 claim
  应 downgrade 到 `unsupported_by_evidence`，而不是让模型补齐。

- Phase 13 最好拆成三步：
  1. supervisor 侧 policy/scope verdict hardening
  2. rag-specialist 侧 grounding / unsupported hardening
  3. eval / observability / operator diagnostics closeout
</specifics>

<deferred>
## Deferred Ideas

- 面向多产品线的统一 moderation service
- 人工审核队列、case review UI、appeal flow
- 开放域 web-search or world-knowledge safety policy
- 完整的 provider-agnostic policy engine plugin system
</deferred>

---

*Phase: 13-policy-risk-and-hallucination-control-hardening*
*Context gathered: 2026-04-11*
