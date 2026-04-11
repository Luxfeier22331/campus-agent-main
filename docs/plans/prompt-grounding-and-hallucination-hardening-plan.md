---
doc_type: plan
status: active
created: 2026-04-06
updated: 2026-04-11
---

# Prompt Grounding And Hallucination Hardening Plan

**Goal:** 在不把 repo 改写成 prompt-first orchestration 的前提下，把当前 prompt-family substrate、grounding gate 和 hallucination control 闭环提升到可持续演进、可验证、可观测的状态。

**Architecture:** 继续遵守 `code-first orchestration + prompt-scoped reasoning`。`policy / scope / authz / serving truth` 保持 code-owned；prompt 只负责 wording；`post-LLM contract` 负责 strict output、grounding downgrade 与 deny-path shaping。

**Current Landed State:** 当前 repo 已经完成：

- package-owned prompt registry / typed prompt packet substrate
- `supervisor_clarify_v1`、`supervisor_approval_required_v1`、`supervisor_reject_v1`、`supervisor_out_of_scope_v1`
- `rag_answer_v1`、`rag_clarify_v1`、`rag_no_answer_v1`、`rag_unsupported_v1`
- prompt packet / typed output / prompt trace strict validation seam
- prompt-generated completed answer 的 claim-level grounding validator 与 `unsupported_by_evidence` downgrade
- `out_of_scope`、`policy_refusal`、`restricted_access_denied`、`unsupported_by_evidence`、`freshness_fail_close` 的 failure-class eval coverage
- `semantic_outcome`、`grounding_verdict`、`grounding_downgraded`、`freshness_fail_closed` 的 diagnostics / projection substrate
- `curriculum` 高结构答案、`handbook procedure/materials/deadline/time` 高精度 path、restricted deny final semantics 的 deterministic-first protection

**Residual Gap:** 当前剩余 gap 已收敛为：

- repo-default product-path prompt stack 还没有把 `repo-global invariants -> package-owned role prompt -> typed task/evidence packet -> strict output contract` 作为默认运行时真相落地
- provider-backed strict structured output runtime 还不是默认 product-path capability
- repo-default prompt metadata sink 还没有把 `prompt_version` / `template_sha256` / `model` 端到端落进产品主链路
- grounding validator 仍是最小可用强度，尚未覆盖更广的 claim 类型与 provider-agnostic grounded-generation runtime

## Desired End State

完成后必须同时成立：

1. repo-global system invariants 保持极薄，不再朝 monolithic mega prompt 演化
2. 产品主链路默认采用 `repo-global developer invariants + package-owned role prompt + typed trusted/untrusted packets + code-side finalization`，而不是回退到单块 mega system prompt
3. `supervisor` / `rag-specialist` 的 prompt family 继续按 mode 拆分，不把 routing / authz / serving truth 推回 prompt
4. provider-backed prompt execution 能返回 strict typed outputs，不依赖 prompt-only 格式约束
5. `completed` 回答在出站前经过 claim-level grounding validator；不满足则自动降级为 `unsupported_by_evidence`
6. `out_of_scope`、`policy_refusal`、`restricted_access_denied`、`unsupported_by_evidence`、`freshness fail-close` 各自有独立 eval coverage

## Non-Goals

本轮不做：

- prompt-first routing
- 让 `retrieval-core` 拥有 top-level system prompt
- 用 LLM 替代 deterministic curriculum / handbook 高结构答案
- 把 external world knowledge fallback 打进 campus path
- 用“更长的 prompt”代替 grounding / ACL / scope code gate

## Workstream 0: Final Prompt Stack Freeze

状态：`not_started`

目标：

- 把“system prompt”的最终产品形态正式冻结为 repo-global thin invariants + package-owned role prompt + typed task/evidence packet + code-side finalization

建议文件：

- `docs/architecture/prompt-and-instruction-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `apps/supervisor-api`
- `apps/app-api`
- `packages/supervisor-core/src/campus_supervisor_core/prompts/`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/`

实现要点：

- 对 OpenAI-compatible runtime，把 repo-global 一层实现为稳定的 `developer message`，而不是 monolithic mega system prompt
- 明确 `trusted task packet` 与 `untrusted evidence/user packet` 的装配边界，不允许 untrusted content 进入 developer instruction zone
- 明确 `system prompt` 在仓库里的语义只是产品沟通 shorthand，不再等于真正的 runtime assembly shape
- 让 `apps/supervisor-api` / product runtime 在接入 provider-backed executor 时统一消费同一套 prompt stack，而不是各自拼 prompt
- 不把 routing / authz / serving truth 倒灌回 prompt 文案

## Workstream 1: Strict Structured Output Runtime

状态：`partial`

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

状态：`landed_baseline`

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

当前已落地基线：

- prompt-generated completed answer 已执行 answer-to-evidence 校验
- 当前最小 claim extractor 已覆盖 title / time / requirement claim
- grounding 不通过时，结果会自动 downgrade 为 `unsupported_by_evidence`

后续补强重点：

- 扩大 claim 类型覆盖
- 评估是否需要从启发式 extractor 升级到更强的 grounded-generation runtime

## Workstream 3: Freshness And Fail-Close Posture

状态：`landed_baseline`

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

当前已落地基线：

- official-web stable-reference-like surface 已对 freshness-sensitive 问题 fail-close
- freshness fail-close 已进入 semantic outcome 与 eval truth

## Workstream 4: Observability And Prompt Metadata

状态：`partial`

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

当前已落地基线：

- `semantic_outcome`
- `grounding_verdict`
- `grounding_downgraded`
- `freshness_fail_closed`
- `prompt_trace` diagnostics seam

当前主要剩余项：

- `prompt_version`
- `template_sha256`
- `model`

## Workstream 5: Eval Lanes For Hallucination Classes

状态：`landed_baseline`

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

当前已落地基线：

- `out_of_scope`
- `policy_refusal`
- `restricted_access_denied`
- `unsupported_by_evidence`
- `freshness_fail_close`

后续补强重点：

- `clarification_instead_of_guess`
- `citation_required_answer`
- prompt-family regression artifact retention

## Workstream 6: Deterministic Path Protection

状态：`landed_baseline`

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

剩余工作建议顺序：

1. 冻结并落地 repo-default product-path prompt stack
2. 接受 product-owned provider-backed prompt runtime boundary
3. 补齐 repo-default prompt metadata sink
4. 强化 claim-level grounding validator
5. 补齐剩余 prompt-family regression / quality evidence

原因：

- product-path prompt stack 未冻结前，不应把“system prompt”继续当作模糊术语写进运行时或 operator 预期
- provider runtime boundary 未冻结前，不应把 eval-side execution 偶然性倒灌进产品主路径
- metadata sink 不补齐，后续 prompt release 无法形成稳定 operator truth
- grounding validator 需要继续增强，但不应推翻已经落地的 deterministic protected paths

## Verification

当前应继续补强以下验证：

- prompt stack assembly / trusted-vs-untrusted zoning tests
- provider-backed prompt runtime schema tests
- grounding validator 扩展回归 tests
- prompt metadata sink contract tests
- prompt-family regression evals with artifact retention

## Deliverables

当前剩余交付物：

- 一套 repo-default product-path prompt stack
- 一套 repo-accepted product-owned prompt runtime boundary
- 一组 repo-default prompt metadata sink 字段
- 一套更强的 grounding validator / grounded-generation runtime
- 一组扩展后的 prompt-family regression artifacts
