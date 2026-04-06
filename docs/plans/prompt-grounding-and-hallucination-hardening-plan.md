---
doc_type: plan
status: active
created: 2026-04-06
updated: 2026-04-06
---

# Prompt Grounding And Hallucination Hardening Plan

**Goal:** 在不把 repo 改写成 prompt-first orchestration 的前提下，把当前 prompt-family substrate、grounding gate 和 hallucination control 闭环提升到可持续演进、可验证、可观测的状态。

**Architecture:** 继续遵守 `code-first orchestration + prompt-scoped reasoning`。`policy / scope / authz / serving truth` 保持 code-owned；prompt 只负责 wording；`post-LLM contract` 负责 strict output、grounding downgrade 与 deny-path shaping。

**Current Gap:** 当前 repo 已有 package-owned prompts、typed prompt packet、prompt executor protocol、`semantic_outcome` 与 `citation_expected` substrate，但还缺：

- provider-backed strict structured output runtime
- claim-level grounding validator
- hallucination failure-class eval lane
- repo-default prompt metadata / grounding verdict sink

## Desired End State

完成后必须同时成立：

1. repo-global system invariants 保持极薄，不再朝 monolithic mega prompt 演化
2. `supervisor` / `rag-specialist` 的 prompt family 继续按 mode 拆分，不把 routing / authz / serving truth 推回 prompt
3. provider-backed prompt execution 能返回 strict typed outputs，不依赖 prompt-only 格式约束
4. `completed` 回答在出站前经过 claim-level grounding validator；不满足则自动降级为 `unsupported_by_evidence`
5. `out_of_scope`、`policy_refusal`、`restricted_access_denied`、`unsupported_by_evidence`、`freshness fail-close` 各自有独立 eval coverage

## Non-Goals

本轮不做：

- prompt-first routing
- 让 `retrieval-core` 拥有 top-level system prompt
- 用 LLM 替代 deterministic curriculum / handbook 高结构答案
- 把 external world knowledge fallback 打进 campus path
- 用“更长的 prompt”代替 grounding / ACL / scope code gate

## Workstream 1: Strict Structured Output Runtime

目标：

- 让 provider-backed prompt execution 在产品路径上具备 strict schema 能力

建议文件：

- `packages/supervisor-core/src/campus_supervisor_core/prompt_execution.py`
- `packages/rag-specialist/src/campus_rag_specialist/prompt_execution.py`
- 新增共享 prompt runtime boundary（位置待定，但不得放进 `packages/contracts`）
- `packages/supervisor-core/src/campus_supervisor_core/prompts/registry.py`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/registry.py`

实现要点：

- 明确 `variables_schema_version` / `output_schema_version`
- provider 输出必须经过 strict schema validation
- schema mismatch 不得 silently coerce 成“看起来能用”的自由文本
- 失败时应显式落成 `error` 或降级到 deterministic fallback，而不是放行脏结果

## Workstream 2: Claim-Level Grounding Validator

目标：

- 对 `citation_expected=true` 的回答做 answer-to-evidence 校验

建议文件：

- `packages/supervisor-core/src/campus_supervisor_core/policy.py`
- `packages/supervisor-core/src/campus_supervisor_core/response.py`
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- 可新增 `packages/rag-specialist/src/campus_rag_specialist/grounding_validation.py`

实现要点：

- `completed` 但 supporting evidence 为空时，直接降级
- 对关键 claim 做 minimal structured extraction：
  - 对象名
  - 制度名
  - 时间/期限
  - 数量
  - eligibility / requirement 条件
- 若上述 claim 无法从 evidence packet 对齐支持，直接降级为 `unsupported_by_evidence`
- restricted deny / hidden content 继续优先于普通 unsupported

## Workstream 3: Freshness And Fail-Close Posture

目标：

- 防止 freshness-sensitive 问答走出 runtime opening policy 之外

建议文件：

- `packages/supervisor-core/src/campus_supervisor_core/query_policy.py`
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- collection-specific runtime profile / policy docs

实现要点：

- 将 `freshness_sensitive` 升级为 prompt/task packet 的显式字段
- freshness-sensitive 且 collection 未开放时，直接 fail-close
- 不允许 prompt 用“可能/通常/一般来说”来掩盖 freshness 缺口

## Workstream 4: Observability And Prompt Metadata

目标：

- 让 grounding / hallucination 失败能被 operator 和 eval 明确观测

建议文件：

- `packages/supervisor-core/src/campus_supervisor_core/response.py`
- `apps/app-api` 对应 projection / observability sink
- operator-facing observability docs

最小新增字段建议：

- `prompt_id`
- `prompt_version`
- `template_sha256`
- `semantic_outcome`
- `grounding_verdict`
- `citation_expected`
- `citation_missing`
- `grounding_downgraded`
- `freshness_fail_closed`

## Workstream 5: Eval Lanes For Hallucination Classes

目标：

- 把 hallucination 治理变成可回归的 repo gate，而不是人工感受

建议文件：

- `packages/evals/src/campus_evals/`
- `tests/supervisor/`
- `tests/specialist/`
- `tests/evals/`

建议最小 lane：

1. `out_of_scope`
2. `policy_refusal`
3. `restricted_access_denied`
4. `unsupported_by_evidence`
5. `freshness_fail_close`
6. `clarification_instead_of_guess`
7. `citation_required_answer`

## Workstream 6: Deterministic Path Protection

目标：

- 防止 prompt rollout 破坏已稳定的高结构 deterministic path

建议文件：

- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- `packages/rag-specialist` 下 curriculum / handbook query planning 与 deterministic composer
- 相关 tests/evals

保护规则：

- curriculum 高结构答案继续 deterministic first
- handbook `procedure / materials / time` 高精度 path 继续 deterministic first
- restricted deny final safety semantics 不改成 prompt-first

## Execution Order

建议顺序：

1. strict structured output runtime
2. claim-level grounding validator
3. observability fields
4. hallucination eval lanes
5. deterministic path protection sweep

原因：

- 没有 strict output 与 validator，先做 wording prompt 优化只会扩大不确定性
- 没有 observability 和 eval，后续无法判断 hallucination control 是否真的改善

## Verification

至少应新增或补强以下验证：

- prompt packet / prompt output schema tests
- grounding downgrade unit tests
- supervisor finalization tests
- unsupported / out-of-scope / restricted deny contract tests
- prompt-family regression evals with artifact retention

## Deliverables

本计划完成后至少应新增：

- 一套 repo-accepted prompt runtime boundary
- 一套 claim-level grounding validator
- 一组 hallucination failure-class evals
- 一组 operator-visible grounding verdict / downgrade metrics
