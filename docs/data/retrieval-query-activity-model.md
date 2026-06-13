---
doc_type: data
truth_scope: data
owner_boundary: packages/retrieval-core
status: active
created: 2026-04-21
updated: 2026-06-05
---
# Retrieval Query Activity Model

## 文档边界

本文冻结 planner-first retrieval 中 query activity、step result、candidate set 与
supporting evidence 的逻辑数据模型。

它回答的是：

- `StepResult` 的四层结构在逻辑上如何落地
- retrieval query activity 如何映射到 durable step trajectory
- 哪些对象属于 internal execution truth，哪些对象可以进入 operator / browser surface
- supporting evidence 与 candidate set 的关系是什么
- canonical reference / reader jump 应从哪一层派生

它不负责：

- 具体数据库表、对象存储 key 或 telemetry sink schema
- browser-facing source card HTTP shape
- retrieval backend vendor payload
- 当前 single-shot baseline 的一次性补丁

## Goal

在不把 raw retrieval trace 直接暴露给上层的前提下，为 multi-step executor、operator
observability、badcase / RAGAS / golden dataset、supporting evidence selection 与 grounded
synthesis 提供统一数据面。

固定目标：

- query activity 是 execution truth，不是 answer truth
- query activity 必须能回链到 durable `run_id` / `step_id` / `attempt_id`
- supporting evidence 是 candidate set 的受控子集
- canonical reference / reader jump 只从稳定 canonical units 派生
- operator 可见 execution summary 与 browser 可见 evidence summary 必须分层

## Position In Runtime Chain

这组逻辑对象在长期链路中的位置固定为：

`RunStep(planning) -> RetrievalPlan -> RunStep(retrieval/tool/rerank/selection)
-> StepResult[] -> candidate set merge -> supporting evidence selection ->
RunStep(synthesis) -> RunStep(grounding) -> source card / reader target`

因此：

- `StepResult` 是 retrieval execution 的直接产物
- merged candidate set 仍属于 execution truth
- supporting evidence 是回答层可消费的最小证据真相
- source card / reader target 是浏览器安全投影，不回退成 raw candidate trace
- synthesis 只能消费 supporting evidence 与 typed tool results；不能补齐缺失 retrieval result

## Core Conclusion

`StepResult` 固定拆成四层：

- `grounding`
- `references`
- `activity`
- `failure`

这四层必须彼此分开，不能互相冒充：

- `grounding` 不是 citation card
- `references` 不是 raw debug trace
- `activity` 不是 answer evidence
- `failure` 不是 browser-facing error message

## Current Admitted Operator Projection

当前已 admission 到 operator observability 的不是整份 `QueryActivity`，而是它的一个 受控子集
`retrieval_plan_summary`：

- `plan_id`
- `run_id`
- `query_mode`
- `replan_count`
- `terminal_state`
- `step_activities[]`
  - `step_id`
  - `run_step_id`
  - `stage`
  - `step_type`
  - `scope.corpus`
  - `scope.collection`
  - `status`
  - `top_k`
  - `latency_ms`
  - `candidate_count`
  - `reference_count`
  - `failure_kind`
- `stage_attribution`
- `evidence_coverage_verdict`
- `grounding_verdict`

固定约束：

- 这是 operator-safe typed summary，不是 raw query trace
- 不在 panel 返回 step query text、raw filter payload、raw snippets 或 provider-native
  debug fields
- 它与 `sourceTrace.retrieved` / `sourceTrace.supporting` 互补，不互相替代
- 它必须能按 `routing / planning / tool / retrieval / rerank / selection /
  synthesis / grounding / finalization` 归因；不能只把失败归到最终 answer
  quality
- operator quality badcase 与 eval-candidate 读取以 `diagnosisStage` 暴露上述归因；
  legacy `causeClass` 仍是具体症状标签，但诊断主线以 step trajectory /
  `diagnosisStage` 为准

## Logical Objects

### QueryActivity

`QueryActivity` 表示一次 retrieval request 的 execution summary。

最小稳定字段组：

```text
QueryActivity
- run_id: str
- request_id: str
- plan_id: str
- query_mode: str
- admitted_scopes[]: scope ref
- replan_count: int
- step_activities[]: StepActivity
- merged_candidate_ids[]: str
- selected_supporting_evidence_ids[]: str
- stage_attribution:
  - routing
  - planning
  - tool
  - retrieval
  - rerank
  - selection
  - synthesis
  - grounding
- terminal_state:
  - completed
  - failed_closed
  - blocked
```

固定语义：

- `QueryActivity` 只记录执行摘要，不承载整段 grounding 正文
- `merged_candidate_ids` 与 `selected_supporting_evidence_ids` 必须可区分
- terminal state 必须能区分正常完成、fail-close 与被 gate 阻断
- `stage_attribution` 是诊断主线；如果多个阶段失败，必须记录 primary stage 与 supporting
  failure refs

### StepActivity

`StepActivity` 是单个 step 的 compact execution summary。

最小稳定字段组：

```text
StepActivity
- run_id: str
- step_id: str
- run_step_id: str
- attempt_id: str | null
- stage:
  - planning
  - tool
  - retrieval
  - rerank
  - selection
  - synthesis
  - grounding
- step_type: str
- scope:
  - corpus
  - collection
- status:
  - succeeded
  - empty
  - blocked
  - failed
  - skipped
- query_text: str
- filters_applied:
  - version_query
  - authorized_filter_applied
  - selector_summary
- budget_used:
  - top_k
  - timeout_ms | null
- latency_ms: int | null
- candidate_count: int
- reference_count: int
- failure_kind: str | null
```

固定语义：

- `filters_applied` 记录“执行时实际用了哪些 gate / filter”，而不是 planner 自己声称用了什么
- `selector_summary` 只写 compact summary，不写原始大 payload
- `candidate_count` 与 `reference_count` 允许为 `0`
- `run_step_id` 必须引用 durable step ledger；operator projection 不从 raw logs 推断 step
  identity

### GroundingCandidate

`GroundingCandidate` 是 step-level answer-eligible candidate unit。

最小稳定字段组：

```text
GroundingCandidate
- candidate_id: str
- step_id: str
- document_ref:
  - doc_id
  - version_id
- anchor: str | null
- root_unit_id: str | null
- snippet: str
- source_kind:
  - indexed
  - admitted_live
- rank: int
- score_bucket: str | null
```

固定语义：

- `GroundingCandidate` 仍属于 execution truth，不直接等于最终 supporting evidence
- `score_bucket` 只允许使用归一化 bucket 或 rank，不暴露 raw vendor score payload
- `source_kind=admitted_live` 不表示自动成为 answer-bearing evidence；仍受 source-trust 与
  freshness policy 约束

### CanonicalReference

`CanonicalReference` 是稳定 citation / reader jump 所依赖的 canonical locator。

最小稳定字段组：

```text
CanonicalReference
- reference_id: str
- candidate_id: str
- doc_id: str
- version_id: str
- canonical_url: str | null
- anchor: str | null
- root_unit_ids[]: str
- document_title: str
- section_title: str | null
- citation_snippet: str
```

固定语义：

- `CanonicalReference` 必须指向稳定 canonical units
- `root_unit_ids` 是 reader jump / highlight 的稳定目标
- `citation_snippet` 是 browser-safe excerpt，不等于整段 raw chunk trace

### SupportingEvidence

`SupportingEvidence` 是最终允许进入回答的证据子集。

最小稳定字段组：

```text
SupportingEvidence
- evidence_id: str
- candidate_id: str
- reference_id: str
- role:
  - primary
  - supporting
- justification: str | null
```

固定语义：

- `SupportingEvidence` 必须从 `GroundingCandidate + CanonicalReference` 派生
- supporting evidence selection 发生在所有 step execution 之后
- 一条 candidate 可以不进入 supporting evidence
- 回答层、citation、reader jump 都只消费 supporting evidence，不消费 raw candidate set

### FailureRecord

`FailureRecord` 是 bounded retrieval 的 failure / blocked carrier。

最小稳定字段组：

```text
FailureRecord
- failure_kind:
  - budget_exhausted
  - unauthorized_scope
  - unresolved_freshness
  - live_lookup_unavailable
  - no_grounding
  - executor_error
  - evidence_coverage_failed
  - grounding_failed
- terminal: bool
- stage: str
- message: str
```

固定语义：

- `FailureRecord` 只承载 retrieval execution 失败，不承载 app-level transport error
- `terminal=true` 表示必须 fail-close，不能再继续自由生成
- `stage` 必须使用统一阶段词汇，供 badcase / eval / panel 归因

## StepResult Mapping

`StepResult` 与上述逻辑对象的固定映射为：

- `grounding`
  - `GroundingCandidate[]`
- `references`
  - `CanonicalReference[]`
- `activity`
  - `StepActivity`
- `failure`
  - `FailureRecord | null`

固定规则：

- `activity.step_id` 必须与 `StepResult.step_id` 对齐
- `activity.run_step_id` 必须与 durable `runtime.agent_run_steps.step_id` 对齐
- `CanonicalReference.candidate_id` 必须引用已存在的 `GroundingCandidate`
- `FailureRecord` 非空时，`status` 只能是 `blocked` 或 `failed`

## Operator-Safe Vs Browser-Safe Projection

固定分层：

- internal execution truth
  - `QueryActivity`
  - `StepActivity`
  - full `GroundingCandidate`
  - full `FailureRecord`
- operator-safe projection
  - compact `QueryActivity`
  - selected step summaries
  - selected supporting evidence summary
  - sanitized durable step trajectory summary
  - stage attribution
- browser-safe projection
  - `SupportingEvidence`
  - `CanonicalReference`
  - source card / reader target

固定约束：

- operator projection 不直接暴露 raw vendor payload
- operator projection 不直接暴露 raw prompt、raw provider response、raw source
  body、raw step payload 或 auth material
- browser projection 不直接暴露 raw candidate trace、query text history 或 failure
  internals
- browser source card 只能从 `SupportingEvidence + CanonicalReference` 派生

## Derivation Rules

固定派生关系：

- `GroundingCandidate.anchor / root_unit_id`
  - 来自 canonical document units 或 admitted live canonicalizer，不从 chunk id 反推
- `CanonicalReference`
  - 来自 canonical document / reader truth，而不是 retrieval backend 私有 locator
- `SupportingEvidence`
  - 由 `knowledge` 的 evidence selection policy 从 merged candidate set 中受控选出
- `QueryActivity.selected_supporting_evidence_ids`
  - 只记录结果引用，不重复内嵌 browser payload
- `QueryActivity.stage_attribution`
  - 从 durable step status、failure record、coverage verdict 与 grounding verdict 派生，不从
    free-text answer judge 反推

## Non-Goals

- 不把 query activity 扩成 browser-facing debug transcript
- 不把 candidate set 直接暴露成回答依据
- 不把 `StepResult` 降成只有 snippets 的无结构列表
- 不把 canonical reference 降成 raw trace id 或 vendor hit id
- 不让 RAGAS low-score case 只停留在分数列表；必须能回链到 durable step trajectory 与阶段归因

## 相关稳定文档

- `docs/contracts/knowledge-retrieval-plan-contract.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/data/canonical-document-reader-model.md`
- `docs/contracts/capability-execution.md`
