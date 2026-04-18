---
doc_type: plan
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Hallucination Governance And Grounded Generation Execution Plan

**Goal:** 把当前 repo 已有的 fail-close baseline，升级为可持续演进的 grounded-generation system：先判语义边界，再判检索充分性，再判 claim support，最后才允许输出 `grounded_answer`。

## Why

当前 repo 已经具备：

- `policy_refusal / out_of_scope / needs_clarification / restricted_access_denied / unsupported_by_evidence / freshness_fail_close` 的语义分流
- deterministic protected paths
- prompt answer grounding downgrade baseline
- prompt metadata / prompt runtime state observability

但它还没有把以下能力收口成 repo-default runtime truth：

- retrieval adequacy gate
- provider-agnostic grounded-generation runtime
- expanded claim taxonomy
- prompt-family groundedness artifact retention

## External Alignment

该设计对齐当前主流最佳实践，但保持 repo-owned truth：

- OpenAI：持续 eval、不要把可靠性寄托给单次 prompt 调整
- Anthropic：provider-native citations 有价值，但不应取代应用自己的 truth contract
- Google / Azure：groundedness 与 retrieval adequacy 应拆开治理，而不是混成一个“回答质量”分数
- Self-RAG / CRAG：retrieval 质量不足时，不应直接答，而应改走 critique / re-route / abstain

参考：

- https://developers.openai.com/api/docs/guides/evaluation-best-practices
- https://developers.openai.com/api/docs/guides/optimizing-llm-accuracy
- https://platform.claude.com/docs/en/build-with-claude/citations
- https://cloud.google.com/generative-ai-app-builder/docs/check-grounding
- https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/rag-evaluators
- https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview
- https://arxiv.org/abs/2310.11511
- https://arxiv.org/abs/2401.15884

## Closeout Status (2026-04-12)

Phase 15 的 repo-local code closeout 已完成：

- Wave A: retrieval adequacy contract
- Wave B: provider-agnostic grounding runtime 与 canonical claim-support schema
- Wave C: eval gating、app-api/runtime/operator observability、schema/contract projection
- Wave D: focused local verification 与 blocker-aware planning closeout

当前仍未完成的不是 repo-local code work，而是 live artifact refresh follow-up：

- 2026-04-12 已把 supplemental eval provider 从 `https://www.su8.codes/codex/v1` 切换到 `https://codex.gbro.site/v1`
- 因此当前 phase 不再受原 `su8` `/responses` regression 阻断
- 但新的 live artifact replacement 仍待单独 rerun；在 rerun 完成前，不宣称已重建新的 live prompt-family artifact

## Phase 15 Local Gate Set

Phase 15 当前冻结的 repo-local verification contract 为：

```bash
uv run --all-packages --no-sync python -m unittest \
  tests.contracts.test_models \
  tests.specialist.test_rag_specialist \
  tests.evals.test_golden_cases \
  tests.evals.test_runtime_observability \
  tests.evals.test_curriculum_live_benchmark

pnpm --dir apps/app-api exec vitest run \
  test/request-observability.test.ts \
  test/operator-query.route.test.ts
```

补充 closeout verification：

```bash
pnpm --dir apps/app-api exec vitest run \
  test/request-diagnostics.test.ts \
  test/request-observability.test.ts \
  test/operator-query.route.test.ts \
  test/operator-query.service.test.ts \
  test/supervisor-adapter.test.ts

pnpm --dir apps/app-api exec vitest run test/projection.service.test.ts
pnpm --dir apps/app-api exec tsc -p tsconfig.json --noEmit
```

这些 gate 明确覆盖四条面：

- contracts truth
- specialist grounding / adequacy regressions
- eval release-gate regressions
- app-api observability / operator projection truth

## Target Design

### 1. Semantic Gate Before RAG

- `supervisor` 继续先判 `policy_refusal / out_of_scope / approval_required / needs_clarification / in_scope_knowledge`
- 域外问题、明显违规问题、审批问题不得伪装成普通 retrieval miss

### 2. Retrieval Adequacy Gate

- `rag-specialist` 在生成前显式判断：
  - target scope 是否正确
  - target document family 是否足够收敛
  - supporting evidence 是否足量
  - alias / short-fragment / family ambiguity 是否仍未消除
- adequacy 不足时，只能进入：
  - `needs_clarification`
  - `unsupported_by_evidence`
  - `freshness_fail_close`
  - `restricted_access_denied`

### 3. Answer Mode Selection By Truth Tier

- `deterministic_first`
  - curriculum 高结构答案
  - handbook `procedure / materials / deadline / time`
  - restricted deny final semantics
- `grounded_generation`
  - 仅用于 evidence 足够且不属于 deterministic protected path 的回答
- `abstain_or_clarify`
  - adequacy 不足或 claim support 不足时进入

### 4. Provider-Agnostic Grounding Runtime

- 生成后统一进入 repo-owned grounding runtime
- runtime 输入：
  - normalized answer text
  - normalized evidence bundle
  - optional provider-native citations / grounding supports
- runtime 输出：
  - `grounding_verdict`
  - `unsupported_fields`
  - `claim_supports`
  - `grounding_downgraded`
- provider-native citations 只能作为 input，不得直接成为 canonical truth

### 5. Canonical Claim Taxonomy

第一版正式 taxonomy 至少覆盖：

- `title_or_entity_identity`
- `time_or_deadline`
- `quantity_or_credit_or_score_requirement`
- `semester_or_grade_or_term_placement`
- `audience_or_major_or_program_or_class_family`
- `offering_unit_or_owning_school`
- `procedure_step`
- `material_requirement`
- `eligibility_requirement`
- `freshness_sensitive_status`
- `authorization_sensitive_claim`

### 6. Source-Trust Tier

grounding 必须同时看 claim 与 source tier 是否匹配：

- `T0 structured deterministic truth`
- `T1 canonical institution documents`
- `T2 stable reference web truth`
- `T3 freshness-capable live truth`

例如：

- `T2` 不可支撑 freshness claim
- `T0/T1` 可优先支撑 curriculum / handbook canonical claims
- restricted truth 即使命中也不能越权出站

### 7. Eval / Observability As Release Gate

release gate 至少拆为：

- retrieval adequacy
- groundedness
- clarification instead of guess
- citation-required answer
- false refusal
- false allow

operator / eval 投影至少保留：

- `semantic_outcome`
- `grounding_verdict`
- `grounding_downgraded`
- `unsupported_fields`
- `prompt_runtime_state`
- `prompt_runtime_detail`
- retrieval adequacy summary
- claim-support summary

## Phase 15 Execution Waves

当前 phase planning 已正式落盘到 `.planning/phases/15-grounded-generation/`，执行入口为 `$gsd-execute-phase 15`。

### Wave A: Retrieval Adequacy Contract

目标：

- 冻结 retrieval adequacy 的 runtime contract 和 fail-close branching

交付：

- adequacy verdict schema
- alias / ambiguity / multi-candidate / weak-support diagnostics
- `clarification_instead_of_guess` gate baseline
- Wave A 已完成的第一批 contract truth：
  - `RagResultDiagnostics.retrieval_adequacy_verdict`
  - `RagResultDiagnostics.retrieval_adequacy_reason`
  - planner/evidence/no-support/prompt-answer path 的 adequacy verdict 写入

建议落点：

- `packages/rag-specialist`
- `packages/retrieval-core`
- `packages/contracts`
- `packages/evals`

对应计划文件：

- `.planning/phases/15-grounded-generation/15-01-PLAN.md`

### Wave B: Grounding Runtime And Claim Schema

目标：

- 把当前 grounding validator 升级为 provider-agnostic runtime

交付：

- canonical `ClaimSupport` / `GroundingVerdict` schema
- expanded claim taxonomy
- provider-native citation/support normalizer
- downgrade policy for unsupported critical claims
- Wave B 已完成的第二批 grounding truth：
  - `ClaimSupport`
  - `RagResultDiagnostics.claim_supports`
  - `normalize_provider_grounding_supports()`
  - provider-agnostic `validate_prompt_answer_grounding()` claim-level verdicts

建议落点：

- `packages/rag-specialist/src/campus_rag_specialist/grounding_validation.py`
- `packages/shared`
- `packages/contracts`
- `packages/supervisor-core`

对应计划文件：

- `.planning/phases/15-grounded-generation/15-02-PLAN.md`

### Wave C: Eval, Artifact, And Observability Expansion

目标：

- 让 hallucination governance 进入持续 release gate

交付：

- `clarification_instead_of_guess` eval lane
- `citation_required_answer` eval lane
- claim-level regression cases
- prompt-family artifact retention contract
- Wave C 已完成的第三批 release-gate / observability truth：
  - `packages/evals` 新增 `retrieval_adequacy_accuracy` 与 `grounding_claim_accuracy`
  - `clarification_instead_of_guess` / `citation_required_answer` 成为 deterministic eval lane
  - `app-api` 将 `retrieval_adequacy_verdict` / `retrieval_adequacy_reason` / `claim_support_summary` 写入 operator-safe runtime fact
  - operator detail 只暴露 compact summary，不暴露 raw `claim_supports`、support snippet 或 provider-native citation blob

建议落点：

- `packages/evals`
- `apps/app-api`
- operator observability docs

对应计划文件：

- `.planning/phases/15-grounded-generation/15-03-PLAN.md`

### Wave D: Acceptance And Runtime Closeout

目标：

- 用真实 artifact 收口 Phase 15，而不是停留在 repo-local unit tests

交付：

- refreshed prompt-family regression artifacts
- updated live gate artifacts after running the follow-up rerun on the gbro supplemental eval provider
- source-of-truth docs closeout

当前待执行项：

- curriculum supplemental eval provider 已切到 `https://codex.gbro.site/v1`，但 live artifact refresh 仍待单独 rerun 执行

对应计划文件：

- `.planning/phases/15-grounded-generation/15-04-PLAN.md`

## Explicit Non-Goals

- 不引入 open-domain web fallback
- 不把 memory / profile / recent goal 提升为事实证据
- 不把 provider-native citation 格式直接当 canonical truth
- 不用单一 mega prompt 替代 retrieval adequacy / grounding runtime
