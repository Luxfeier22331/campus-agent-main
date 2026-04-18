---
doc_type: phase_plan
phase: "F"
phase_name: "Source-Trust Tier Runtimeization"
status: completed
created: 2026-04-19
updated: 2026-04-19
---

# Phase F Plan

## Objective

把 `source-trust tier` 从 execution-plan 里的设计概念收口成 repo-owned runtime truth，直接进入 contracts、grounding、diagnostics、operator observability 与 release gate。

## Why This Phase Exists

当前 repo 已经有：

- `EvidenceSource.source_channel`
- `ClaimSupport`
- `RagResultDiagnostics`
- request diagnostics / observability projection

但还没有：

- 显式 `T0-T3` taxonomy
- source surface 到 tier 的 canonical mapping
- `claim type x source tier x freshness sensitivity` 的 runtime 裁决
- app-owned `source_trust_summary` projection

如果这一步不先冻结，`Phase G-K` 都会继续在“哪些来源算高信任、哪些 claim 允许被哪些来源支撑”上重复做决策。

## Decisions To Freeze

1. `source_trust_tier` 采用显式四层，不再使用模糊的高/中/低描述：
   - `T0`: structured deterministic truth
   - `T1`: canonical institution documents
   - `T2`: stable reference web truth
   - `T3`: freshness-capable live truth
2. canonical surface mapping 固定为：
   - `T0`
     - repo-owned structured deterministic facts
     - deterministic protected-path backing facts
     - `curriculum/curriculum_plan`
     - `curriculum/program_semester_facts`
     - `curriculum/program_family_facts`
     - `curriculum/course_facts`
   - `T1`
     - `regulations/student_handbook`
     - canonical institution documents in authenticated / restricted corpora
   - `T2`
     - `official_web/stable_reference`
     - other stable reference web surfaces admitted into query-serving
   - `T3`
     - `official_web/fresh_news`
     - future authenticated live portal / live export surfaces that are explicitly freshness-capable
   - `T0-derived` 只是文档口径，用于描述从 `T0` canonical truth 派生出的 internal retrieval surfaces；它不是新的 `source_trust_tier` enum，contract projection 仍只允许写 `T0`
3. `source_trust_tier` 是 evidence 属性，不是 authz 或 serving-surface 决策器。
4. `source_trust_tier` 绝不能 override：
   - retrieval ACL
   - `restricted_access_denied`
   - serving-surface closure
   - deterministic deny semantics
5. claim/tier compatibility 固定为：
   - `freshness_sensitive_status` 只能由 `T3` 支撑；`T2` 一律不足
   - canonical curriculum factual claims 默认要求 `T0`
   - handbook canonical `procedure_step / material_requirement / eligibility_requirement / time_or_deadline` 默认要求 `T1`，但允许消费同一 canonical handbook truth 派生出的 repo-owned deterministic protected-path backing facts (`T0`)
   - `authorization_sensitive_claim` 即使命中 `T0-T3` 也不能越权出站
   - higher tier 不自动覆盖 adequacy / grounding / conflict resolution
6. canonical contract additions 固定为：
   - `EvidenceSource.source_trust_tier`
   - `ClaimSupport.required_source_trust_tier`
   - `ClaimSupport.support_source_trust_tier`
   - new `SourceTrustSummary`
   - `RagResultDiagnostics.source_trust_summary`
7. `SourceTrustSummary` 的最小字段固定为：
   - `observed_tiers`
   - `answer_bearing_tiers`
   - `blocked_claim_types`
   - `freshness_claim_blocked`
   - `authorization_claim_blocked`

## Canonical Claim/Tier Matrix

- `freshness_sensitive_status`
  - minimum tier: `T3`
  - allowed surfaces: `official_web/fresh_news` 与 future authenticated live/export surfaces that are explicitly admitted as freshness-capable
- curriculum canonical claims
  - claim families: `quantity_or_credit_or_score_requirement` / `semester_or_grade_or_term_placement` / `audience_or_major_or_program_or_class_family` / `offering_unit_or_owning_school`
  - minimum tier: `T0`
  - allowed surfaces: `curriculum/curriculum_plan` 与现有 `T0-derived` internal curriculum surfaces；这些 internal surfaces 在 contract projection 中继续写 `T0`，且不开启新的 public query-serving surface
- handbook canonical claims
  - claim families: `procedure_step` / `material_requirement` / `eligibility_requirement` / `time_or_deadline`
  - minimum tier: `T1`
  - allowed surfaces: `regulations/student_handbook`，以及从同一 canonical handbook truth 派生出的 deterministic protected-path backing facts (`T0`)
- `authorization_sensitive_claim`
  - minimum tier: not applicable
  - rule: 继续由 authz / serving-surface / restricted deny semantics 决定，不因 tier 命中而放行

## Execution Slices

### Slice 1: Freeze Canonical Taxonomy And Mapping

- 在 contracts / docs 中冻结 `T0-T3` 名称、定义和 surface mapping
- 明确 current corpora 哪些属于 `T0/T1/T2/T3`，尤其是 `curriculum/curriculum_plan` 与 `T0-derived` internal curriculum surfaces
- 写明 `source_trust_tier` 永不替代 `authz / scope / serving-surface`

### Slice 2: Add Contract Fields

- 为 `EvidenceSource` 添加 `source_trust_tier`
- 为 `ClaimSupport` 添加 tier compatibility fields
- 为 `RagResultDiagnostics` 添加 `source_trust_summary`
- 为 app-api diagnostics / observability / runtime store 增加对应 summary projection

### Slice 3: Apply Tier Rules In Grounding

- 在 grounding runtime 内按 claim type 计算 `required_source_trust_tier`
- 当存在文本支持但 tier 不足时，保留 unsupported path，并把 blocked claim types 投影到 `source_trust_summary`
- `freshness_fail_close` 与 `restricted_access_denied` 继续保持当前 fail-close 语义，不被 tier 提升绕过

### Slice 4: Extend Release-gate Observability

- eval / operator observability 能区分：
  - no textual support
  - textual support but insufficient trust tier
  - freshness blocked by `T2`
  - authorization-sensitive claim blocked despite high-tier evidence

### Slice 5: Lock Regression Coverage

- 为 `T0` curriculum canonical claims、`T1` handbook canonical claims、`T2` freshness mismatch、`T3` live freshness pass-through、restricted deny path 分别新增回归样本

## Interfaces To Freeze

- `packages/contracts/src/campus_contracts/models.py`
  - `EvidenceSource.source_trust_tier: Literal["T0", "T1", "T2", "T3"]`
  - `ClaimSupport.required_source_trust_tier: str`
  - `ClaimSupport.support_source_trust_tier: str`
  - `SourceTrustSummary`
  - `RagResultDiagnostics.source_trust_summary`
- `apps/app-api/src/modules/request-diagnostics.ts`
  - `RequestSourceTrustSummary`
  - `RequestDiagnosticsSummary.sourceTrustSummary`
- `apps/app-api/src/modules/runtime-command/store.ts`
  - `RequestObservabilityFactWrite.sourceTrustSummary`

## Verification Matrix

- contracts regression：
  - `EvidenceSource` only admits `T0-T3`
  - `T0-derived` does not appear as a fifth enum value in canonical contract payloads
  - `SourceTrustSummary` serialization / projection stays stable
- grounding regression：
  - `T2` evidence cannot support `freshness_sensitive_status`
  - `T0` curriculum facts can support curriculum claim types
  - `T1` handbook canonical claims and `T0` handbook deterministic backing facts can support handbook protected paths
  - `authorization_sensitive_claim` stays blocked even with high-tier evidence
- service regression：
  - tier mismatch routes to `unsupported_by_evidence` or `freshness_fail_close`, not false allow
- app-api projection regression：
  - request diagnostics and observability preserve `sourceTrustSummary`
- eval regression：
  - official-web freshness cases fail closed on `T2`
  - live truth cases can pass on `T3`

## Proposed Write Set

- `packages/contracts/src/campus_contracts/models.py`
- `packages/rag-specialist/src/campus_rag_specialist/grounding_validation.py`
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- `apps/app-api/src/modules/request-diagnostics.ts`
- `apps/app-api/src/modules/request-observability.ts`
- `apps/app-api/src/modules/runtime-command/store.ts`
- targeted regressions under `tests/specialist/`, `tests/evals/`, and `apps/app-api/test/`

## Exit Rule

Phase F 完成后，repo 应达到：

- `T0-T3` taxonomy 与 surface mapping 已冻结，不再需要在后续 phase 里重开定义
- `curriculum/curriculum_plan` 与现有 internal curriculum derived surfaces 已固定为 `T0/T0-derived`
- `source_trust_tier` 已进入 canonical contracts 与 app-owned projection
- tier mismatch 与 textual mismatch 能在 diagnostics / observability / eval 中被区分
- `Phase G/H/I` 可以直接消费 `source_trust_tier` 和 `source_trust_summary`，不再补上游口径
