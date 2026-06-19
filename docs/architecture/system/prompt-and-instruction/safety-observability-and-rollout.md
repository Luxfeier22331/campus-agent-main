---
doc_type: architecture
truth_scope: execution
owner_boundary: docs/architecture/system/prompt-and-instruction
status: active
created: 2026-06-13
updated: 2026-06-14
---

# Prompt And Instruction Safety Observability And Rollout

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## Trusted Vs Untrusted Zones

prompt packet 长期固定拆成 trusted / untrusted 两区。

### Trusted Zone

只允许放：

- role instructions
- hard invariants
- output contract
- task packet 中的 typed fields
- explicit safe summaries

### Untrusted Zone

只允许放：

- retrieved snippets
- external web text
- user-provided free text
- imported note / memory text
- operator-entered annotations

规则固定为：

- untrusted zone 永远不能写成 instructions 口吻
- 不把 evidence snippet 拼到 role instructions 里
- 不让 retrieval content 覆盖 system / developer intent

推荐统一使用结构标签，例如：

- `<role>`
- `<invariants>`
- `<task>`
- `<evidence>`
- `<output_contract>`

## Task Packet Contract

task packet 由 code 生成，不由模型猜。

第一版推荐字段：

- `request_id`
- `mode`
- `language`
- `task_kind`
- `resolved_scope`
- `requested_capability`
- `personalization_mode`
- `allowed_actions`
- `forbidden_actions`
- `response_constraints`
- `output_schema_name`

knowledge / RAG capability 可额外带：

- `query_plan_kind`
- `clarification_reason`
- `canonical_entity_ids`
- `citation_expected`
- `no_answer_reason`
- `semantic_outcome_hint`

补充推荐字段：

- `grounding_required`
- `freshness_sensitive`
- `high_structure_mode`

这些字段的目的不是把 policy judgement 交给 prompt，而是让 prompt executor 与 post-LLM validator
在同一套 typed contract 上工作。

## Evidence Packet Contract

evidence packet 必须结构化，而不是大段自由拼接。

每条 evidence 至少包含：

- `doc_id`
- `source_title`
- `detail_label`
- `structural_path`
- `snippet`
- `safe_summary`

如场景需要，还可带：

- `canonical_course_id`
- `canonical_program_family_id`
- `content_role`
- `source_rank`

禁止直接注入：

- raw registry rows
- raw JWT / raw auth envelope
- hidden internal memory
- full prompt history dump

## Personalization Rules

prompt 只能消费已经过 code 过滤的 personalization inputs。

允许进入 prompt 的只包括：

- `user_visible` profile memory
- confirmed session slots
- safe actor claim terms

不允许进入 prompt 的包括：

- `internal_only` profile memory
- raw auth provider payload
- 未经投影的 long-term memory

长期规则保持与
`docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
一致：

- personalization 可以影响 wording、clarification、preference
- 不能扩大 capability opening、source trust、account/session 或 operator access truth

## Observability And Storage

默认 observability 只记录 prompt metadata，不记录 raw prompt。

最小记录字段：

- `prompt_id`
- `prompt_version`
- `template_sha256`
- `model`
- `request_id`
- `mode`
- `variables_schema_version`
- `output_schema_version`
- `citation_count`
- `grounding_verdict`
- `policy_verdict`

默认不记录：

- raw full prompt
- raw full answer
- raw transcript
- raw snippet dump
- raw long-term memory

如需 debug：

- 必须显式 opt-in
- 必须走 redaction / minimization
- 不得把 debug payload 视为长期默认日志真相

## Eval And Release Gate

prompt 变更不是纯文案改动，而是 release-relevant change。

每次 prompt family 变更至少要经过三层 gate：

1. `schema gate`

- prompt variables 是否齐全
- model output 是否满足 typed schema

1. `policy gate`

- clarify / no-answer / deny-path 是否正确
- `policy_refusal`、`out_of_scope`、`unsupported_by_evidence`、`capability_not_ready`
  与 `source_truth_unavailable` 的区分是否正确

1. `quality gate`

- groundedness
- citation completeness
- product wording quality
- ambiguity handling quality
- `unsupported_by_evidence` abstention 是否正确

第一版直接复用现有 repo eval truth：

- `student_rules` live accept
- `curriculum_plan` live accept
- alias / family ambiguity regression
- capability-not-open / source-unavailable / fail-close regression
- out-of-scope / policy-refusal / unsupported-by-evidence regression

prompt version bump 必须与 eval artifact 一起进入变更记录。

## Post-LLM Contract Expectations

长期上，`post-LLM contract` 不应只检查“有没有返回结构化对象”。

至少要补齐以下校验：

1. `schema gate`

- provider 返回是否满足 strict schema

1. `citation gate`

- `citation_expected=true` 时，`completed` 结果不得出现 `0` supporting sources

1. `grounding gate`

- 回答中的关键对象名、条件、时间、数量和制度名，必须能在 evidence packet 找到支持
- 如果关键 claim 找不到支持，应 fail closed 为 `unsupported_by_evidence`

1. `boundary gate`

- 未开放 capability、未可靠摄入的 current-state truth 或内部 source material 不得通过 wording
  包装成可确认答案

1. `freshness gate`

- freshness-sensitive 问答不得越过 runtime opening policy 自行作答

## Current Boundary To Best Practice

当前 repo 方向已经基本正确，但必须区分 online serving truth 与
offline/eval hardening：

1. Go online RAG 当前只承诺 evidence-integrity verification

- `apps/execution-control` 的 `grounding.verify` 检查 synthesis/evidence ref 一致性、
  `answer_text` presence 与 selected evidence `source_ref` presence
- projected diagnostics 使用 `verification_kind=evidence_integrity`
- 当前 online path 不得把空 `grounding_verdict` 默认补成 semantic `grounded`

1. Python claim-level grounding validator 只保留为 offline/eval/historical bridge
   hardening

补充说明：

- hallucination failure-class eval lane 已经显式拆开，不再是当前主要 gap
- repo-default prompt metadata sink 已补齐到 `apps/app-api` / operator / eval
  runtime surface
- `refusal` / `incomplete` / `content-filter` 现在会以 observability-safe typed
  product state 留痕，而不是只作为 fallback reason
- 旧 Python `packages/knowledge-capability` 中的 claim validator 不作为 online serving gate；
  不继续把 Python validator depth 当作主链路实现缺口
- claim-level semantic grounding 只有在 badcase / eval 证明 evidence-integrity 不足时，
  才作为 Go RAG hardening 进入实施

## First-Rollout Strategy

第一版 prompt 不做“大一统重构”，而做增量落地。

### 继续保持 code-owned 的部分

- Execution Agent Layer routing
- deterministic execution terminal wording
- capability opening gate
- serving-surface filter
- retrieval planning
- canonical entity / alias resolution
- high-precision structured answer composer

### 第一版优先 promptify 的部分

- rag clarify wording
- rag no-answer wording
- rag answer naturalization

### 第一版不建议立即 promptify 的部分

- curriculum 课程表 / 学期课表高结构答案
- handbook procedure / materials / time 的高精度 deterministic path
- unavailable / not-open final safety semantics

原因：

- 当前这些路径已经有 deterministic repo truth
- 直接切成 prompt-first 会扩大 regression 面

## Current Repo Implication

对当前 repo 的直接结论是：

- 我们需要显式 prompt architecture，而且当前产品主链路已经落地第一版 runtime seam
- 但不需要把系统改写成 prompt-first RAG
- execution terminal prompt family 当前已移除；deterministic terminal wording 由 Go
  direct terminal path 承接
- knowledge-path prompt 应按 mode 拆分，并避免把 raw capability id 写成 model-facing
  persona
- 结构化、高精度场景继续优先 deterministic composer
- 幻觉治理的主力仍然是 `scope/evidence/finalization/eval`，而不是继续把 system prompt 写得更长

## 当前接受的运行时基线

当前 repo 的稳定运行时基线是：

- package-owned prompt registry、prompt packet 与 strict validation seam
  已成为 knowledge path 产品主链路的一部分
- `apps/execution-control` 已承担 prompt config admission summary；online RAG
  synthesis 由 Go provider adapter 创建 provider request、抽取 usage/cost、
  记录 cancel/timeout outcome，并将 sanitized provider summary 写入 step
  projection。Python `apps/supervisor-agent-worker` 已从 active workspace 删除，
  不再拥有 online provider hot path
- provider-backed strict structured outputs、fail-close refusal handling 与 typed
  prompt metadata 已成为 repo-default posture
- Execution Agent Layer 的 `policy gate + scope gate` 与 Go knowledge-path
  evidence-integrity verification 共同承担当前 online prompt-side hallucination
  control；Python claim-level validator 只保留为 offline/eval/historical bridge
  hardening，不作为 online serving gate
- `curriculum` 高结构答案、`handbook procedure/materials/deadline/time` 高精度 path 与
  not-open / unavailable final semantics 继续保持 deterministic-first protected path

仍属当前 follow-up 但不在本文维护执行顺序的工作：

- badcase/eval-driven Go RAG semantic verification
- 仅在新 surface 或真实 unsupported-answer badcase 触发时扩展 claim taxonomy
- prompt-family live gate artifact 的持续更新

这些工作属于 badcase/eval-driven hardening lane，执行顺序与完成状态以
`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与 GSD SDK / Codex native
session state 为准。

## 外部参考

以下外部资料用于 informing best practice，不替代 repo 内 source of truth：

- OpenAI Responses migration guide
  - `<https://developers.openai.com/api/docs/guides/migrate-to-responses#responses-benefits>`
- OpenAI tools guide
  - `<https://developers.openai.com/api/docs/guides/tools>`
- OpenAI Structured Outputs
  - `<https://platform.openai.com/docs/guides/structured-outputs`>
- OpenAI Evaluation Best Practices
  - `<https://platform.openai.com/docs/guides/evaluation-best-practices`>
- OpenAI Safety Best Practices
  - `<https://platform.openai.com/docs/guides/safety-best-practices`>
- OpenAI Moderation Guide
  - `<https://platform.openai.com/docs/guides/moderation`>
- OpenAI Safety In Building Agents
  - `<https://developers.openai.com/tracks/building-agents/`>
- OpenAI Model Spec
  - `<https://model-spec.openai.com/`>
- Azure Advanced Retrieval-Augmented Generation
- Azure Groundedness Detection
- Azure RAG Evaluators
- Anthropic Citations
- Google Grounding Support / Grounded Generation guidance
- Self-RAG

## 相关稳定文档

- `docs/architecture/current-architecture.md`
- `docs/architecture/system/execution-agent-layer-architecture.md`
- `docs/architecture/system/agent-framework-boundary-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
