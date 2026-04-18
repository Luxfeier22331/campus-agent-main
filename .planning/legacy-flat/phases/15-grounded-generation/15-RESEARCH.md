# Phase 15 Research: 幻觉治理与 Grounded Generation 二次硬化

## External Findings

1. **Hallucination control should be eval-driven, not prompt-driven**
   OpenAI guidance consistently treats evals as the core reliability loop. The practical implication for this repo is that Phase 15 should not introduce a larger anti-hallucination prompt; it should make retrieval adequacy, groundedness, clarification-vs-guess, and false-refusal/false-allow outcomes release-gated.

2. **Groundedness and retrieval quality are separate dimensions**
   Azure and Google both separate retrieval/process quality from answer groundedness. A system can retrieve weak or conflicting evidence and still produce a fluent answer; this is precisely the failure mode Phase 15 needs to eliminate. For this repo, retrieval adequacy must become an explicit pre-generation gate rather than an implicit side effect of low confidence or empty citations.

3. **Provider-native citations are useful inputs but weak canonical truth**
   Anthropic citations and Google grounding supports are useful because they expose model-visible evidence links, but they are provider-shaped outputs. They are helpful as optional inputs to a repo-owned grounding runtime, not as canonical truth that the rest of the product contracts depend on.

4. **Corrective / agentic RAG prefers abstain or re-route over “best effort” answers**
   Self-RAG and CRAG both reinforce the same principle: if retrieval is weak, ambiguous, or low-value, the system should critique, clarify, re-retrieve, or abstain rather than proceed into synthesis. This strongly matches the repo’s accepted fail-closed posture.

5. **Claim-level support beats whole-answer vibe checks**
   Google grounding checks and Azure RAG evaluators both work at claim or support granularity rather than relying only on an overall answer score. For this repo, the next meaningful upgrade is a canonical claim taxonomy with explicit support verdicts, not a better whole-answer judge prompt.

6. **Grounding must be source-tier aware**
   Retrieval sources with different freshness and trust characteristics should not support the same claims. In this repo, `program_semester_facts`, canonical handbook/curriculum documents, stable-reference official-web pages, and future live/freshness-capable surfaces must remain distinct support tiers.

7. **Memory and personalization should not become support evidence**
   The broader best-practice pattern is still to keep personalization as planning bias or clarification context, not as canonical evidence. This remains critical for the repo because verified major, recent goals, and session memory already exist and must not silently hard-resolve claims.

## Closeout Implication

这些外部资料共同支持当前的 Phase 15 closeout 口径：

- OpenAI 的 eval guidance 说明 reliability 应由可重复 regression gate 驱动，因此 Phase 15 可以在 repo-local gate 完整通过后关闭代码 phase，而不是继续等待 live provider 恢复再把本地实现挂成未完成
- Azure / Google 明确把 retrieval quality 与 groundedness 分开；因此 closeout 也必须分别证明 adequacy gate 和 grounding gate，而不是用一条泛化“回答质量”证据替代
- 由此导出的 repo 结论是：
  - repo-local code closeout 与 deterministic gate closeout 可以先完成
  - supplemental provider `/responses` regression 只阻断 live artifact refresh，不阻断本 phase 的 repo-local acceptance closeout

## Repo Implications

### 1. Retrieval adequacy needs its own contract

The current code already distinguishes:

- obvious `out_of_scope` and `policy_refusal` in `packages/supervisor-core`
- `needs_clarification`, `unsupported_by_evidence`, `restricted_access_denied`, and `freshness_fail_close` in `packages/rag-specialist`

But the specialist does not yet expose a first-class retrieval adequacy verdict. Instead, adequacy is currently implicit in:

- `_should_clarify_with_evidence()`
- empty `evidence.sources`
- empty `supporting_evidence.sources`
- low derived confidence
- specific fail-closed clause checks

Phase 15 should turn that into explicit repo truth.

### 2. Grounding runtime should stay repo-owned and provider-agnostic

The current `validate_prompt_answer_grounding()` helper already gives the repo a code-owned grounding seam. The right next step is to extend that seam, not replace it with provider SDK specifics.

The grounding runtime should:

- accept normalized answer text
- accept normalized evidence bundle
- optionally accept provider-native citations / grounding supports
- return canonical repo truth such as `grounding_verdict`, `unsupported_fields`, and `claim_supports`

### 3. Claim taxonomy should mirror real campus question types

The current extractor already covers:

- title claims
- time claims
- requirement claims
- offering unit claims
- audience claims

Phase 15 should formalize and expand this taxonomy so it cleanly covers high-frequency campus asks:

- quantity / credit / score requirement
- semester / grade / term placement
- audience / major / program / class-family applicability
- offering unit / owning school
- procedure step / material / eligibility / deadline
- freshness-sensitive status
- authorization-sensitive claims

### 4. Deterministic protected paths must remain stronger than promptified paths

Phase 15 should not weaken:

- curriculum deterministic answers
- handbook `procedure / materials / deadline / time` deterministic answers
- restricted deny final semantics

Grounded generation should only expand safely around those paths, not replace them.

### 5. Observability should distinguish retrieval failure from grounding downgrade

Current observability already captures:

- `semantic_outcome`
- `grounding_verdict`
- `grounding_downgraded`
- `freshness_fail_closed`
- `prompt_runtime_state`
- `prompt_runtime_detail`

Phase 15 should add enough structure to tell:

- whether the request stopped because retrieval was inadequate before generation
- whether generation happened and was later downgraded by claim support checks
- which claim classes failed

### 6. Phase 15 should produce four implementation waves

Recommended breakdown:

- **15-01**: retrieval adequacy contract + diagnostics + clarify-instead-of-guess baseline
- **15-02**: provider-agnostic grounding runtime + expanded claim support schema
- **15-03**: eval / observability / artifact retention expansion
- **15-04**: phase closeout, acceptance evidence, and blocker-aware live artifact notes

## Recommended Non-Goals

- no open-domain web fallback
- no provider-native citation lock-in as canonical truth
- no memory/profile as support evidence
- no replacement of deterministic protected paths with prompt-first generation
- no single mega-prompt “hallucination shield”

## External References

- OpenAI Evaluation Best Practices: https://developers.openai.com/api/docs/guides/evaluation-best-practices
- OpenAI Optimizing LLM Accuracy: https://developers.openai.com/api/docs/guides/optimizing-llm-accuracy
- Anthropic Citations: https://platform.claude.com/docs/en/build-with-claude/citations
- Google Grounding Check: https://cloud.google.com/generative-ai-app-builder/docs/check-grounding
- Azure RAG Evaluators: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/rag-evaluators
- Azure Agentic Retrieval Overview: https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview
- Self-RAG: https://arxiv.org/abs/2310.11511
- CRAG: https://arxiv.org/abs/2401.15884
