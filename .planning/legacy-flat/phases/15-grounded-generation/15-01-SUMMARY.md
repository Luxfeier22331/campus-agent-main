# 15-01 Summary: retrieval adequacy contract 与 clarify-instead-of-guess baseline

## Outcome

Wave A 已把 retrieval adequacy 从隐式 heuristics 收口为显式 runtime truth：

- `packages/contracts` 的 `RagResultDiagnostics` 现在正式携带：
  - `retrieval_adequacy_verdict`
  - `retrieval_adequacy_reason`
- `rag-specialist` 现在会在生成前把关键分支写成 typed adequacy 结论，而不是只依赖最终 `status`
  - clarification 分支写 `ambiguous`
  - 无支持 / 弱支持 / handbook clause miss 写 `insufficient`
  - prompt-answer generation 成功进入 grounded path 前写 `sufficient`
- retrieval ambiguity 的 code-owned reason 现在至少覆盖：
  - planner-side clarification reason 直传
  - evidence-side `multi_candidate_title`
  - no-support `no_supporting_sources`
  - weak-support `weak_supporting_evidence`
  - handbook fail-close `resolved_policy_clause_not_found`
- prompt grounding downgrade 与 retrieval adequacy 现在被明确拆开：
  - adequacy 先决定能否进入 generation
  - grounding 再决定 generated answer 是否能保留

## Key Changes

- `packages/contracts/src/campus_contracts/models.py`
  - 为 `RagResultDiagnostics` 增加 `retrieval_adequacy_verdict` / `retrieval_adequacy_reason`
- `packages/rag-specialist/src/campus_rag_specialist/retrieval_adequacy.py`
  - 新增 adequacy assessment helper
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
  - 为 clarification / no-answer / prompt-answer 路径补齐 adequacy verdict 写入
  - 将 evidence ambiguity 从布尔判断升级为 reason-bearing branch
- `tests/contracts/test_models.py`
  - 增加 adequacy 字段序列化与字段存在性断言
- `tests/specialist/test_rag_specialist.py`
  - 增加 curriculum alias ambiguity、handbook weak-support、prompt-answer grounded/downgrade 的 adequacy 断言
  - 更新 shared diagnostics helper，使其反映新的 repo truth

## Verification

Fresh Wave A verification:

```bash
uv run --all-packages --no-sync python -m unittest \
  tests.specialist.test_rag_specialist \
  tests.contracts.test_models
```

Result:

- `Ran 151 tests in 0.404s`
- `OK`

## Next

- 进入 `15-02`
- 下一波直接实现 provider-agnostic grounding runtime、canonical claim-support schema 与 expanded claim taxonomy
