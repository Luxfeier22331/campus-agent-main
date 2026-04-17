# 15-02 Summary: provider-agnostic grounding runtime 与 canonical claim-support schema

## Outcome

Wave B 已把 prompt-answer grounding 从扁平 `unsupported_fields` 判断升级成 claim-level runtime truth：

- `packages/contracts` 现在正式冻结 `ClaimSupport`，并让 `RagResultDiagnostics.claim_supports` 成为 canonical 诊断载体
- `packages/shared` 现在提供 `normalize_provider_grounding_supports()`，可以把 provider-native citation / support payload 归一化成 repo-owned support 输入
- `packages/rag-specialist` 的 grounding runtime 现在返回：
  - `grounding_verdict`
  - `unsupported_fields`
  - `claim_supports`
- claim taxonomy 已从旧的 `title / time / requirement` 扩展到：
  - `quantity_or_credit_or_score_requirement`
  - `semester_or_grade_or_term_placement`
  - `audience_or_major_or_program_or_class_family`
  - `offering_unit_or_owning_school`
  - `procedure_step`
  - `material_requirement`
  - `eligibility_requirement`
  - `freshness_sensitive_status`
  - `authorization_sensitive_claim`
- prompt-answer completed / downgrade 两条路径现在都会携带 canonical `claim_supports`，因此 grounded completion 与 unsupported-by-evidence downgrade 都能解释到 claim 粒度

## Key Changes

- `packages/contracts/src/campus_contracts/models.py`
  - 新增 `ClaimSupport`
  - 为 `RagResultDiagnostics` 增加 `claim_supports`
- `packages/shared/src/campus_shared/prompt_runtime.py`
  - 新增 `NormalizedProviderGroundingSupport`
  - 新增 `normalize_provider_grounding_supports()`
- `packages/rag-specialist/src/campus_rag_specialist/grounding_validation.py`
  - 重写 grounding validator
  - 增加 provider-agnostic support candidate normalization
  - 增加 expanded claim taxonomy 与 per-claim support matching
  - 保留 `unsupported_fields` 作为 summary compatibility layer
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
  - completed path 写入 grounded `claim_supports`
  - downgrade path 写入 unsupported `claim_supports`
- `tests/contracts/test_models.py`
  - 覆盖 `ClaimSupport` / `claim_supports` 序列化 truth
- `tests/shared/test_prompt_runtime.py`
  - 覆盖 provider-native grounding support normalization
- `tests/specialist/test_rag_specialist.py`
  - 覆盖 offering-unit / audience / semester / credit claim downgrade
  - 覆盖 provider support input 可被 canonical grounding runtime 消费
  - 覆盖 grounded completion path 的 supported `claim_supports`

## Verification

Fresh Wave B verification:

```bash
uv run --all-packages --no-sync python -m unittest tests.contracts.test_models
uv run --all-packages --no-sync python -m unittest tests.shared.test_prompt_runtime
uv run --all-packages --no-sync python -m unittest tests.specialist.test_rag_specialist
```

Result:

- `tests.contracts.test_models`: `Ran 23 tests` / `OK`
- `tests.shared.test_prompt_runtime`: `Ran 2 tests` / `OK`
- `tests.specialist.test_rag_specialist`: `Ran 129 tests` / `OK`

## Next

- 进入 `15-03`
- 下一波开始补 eval / artifact retention / observability，把 retrieval adequacy 与 claim-support summary 变成 release-gate 证据
