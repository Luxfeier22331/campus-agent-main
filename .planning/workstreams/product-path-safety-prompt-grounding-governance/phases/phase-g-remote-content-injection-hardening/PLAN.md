---
doc_type: phase_plan
phase: "G"
phase_name: "Remote-content Injection Hardening"
status: completed
created: 2026-04-19
updated: 2026-04-19
---

# Phase G Plan

## Objective

为 remote content 建立 repo-owned sanitization、suspicion labeling 与 regression gate，确保外部内容始终作为数据进入 prompt/runtime，而不是作为指令层。

## Why This Phase Exists

当前 repo 已经在 prompt runtime invariant 里声明“retrieved evidence 是 untrusted data”，但还没有真正的 remote-content hardening substrate：

- 没有 `EvidenceSource` 级 suspicion label
- 没有 canonical remote-content sanitization boundary
- 没有 official-web / live-source prompt-injection regression

因此这一步必须把“原则”升级为代码和 eval 都能看见的 runtime truth。

## Decisions To Freeze

1. scope 固定为 remote retrieved content：
   - `official_web`
   - future live/authenticated source surfaces
   - provider-native grounding supports that echo remote content
2. 本 phase 不处理 generic HTML sanitizer、user input moderation 或前端富文本过滤。
3. canonical suspicion labels 固定为：
   - `prompt_override_signal`
   - `instructional_imperative`
   - `secret_or_credential_request`
   - `tool_or_browser_action_request`
   - `hidden_or_embedded_text_marker`
4. canonical contract additions 固定为：
   - `EvidenceSource.remote_content_suspicion_labels`
   - new `RemoteContentSuspicionSummary`
   - `RagResultDiagnostics.remote_content_suspicion_summary`
5. `RemoteContentSuspicionSummary` 的最小字段固定为：
   - `flagged_source_count`
   - `flag_labels`
   - `generation_blocked`
6. sanitization boundary 固定在 evidence -> prompt packet 之间：
   - raw source trace 继续保留
   - prompt-visible summary 使用 sanitized rendering
   - suspicion labels 仍可进入 diagnostics / observability
7. suspicion label 不等于 policy refusal：
   - canonical consequence 是 downgrade / block generation path
   - 不直接把 remote content 当成用户违规请求
8. 当 answer-bearing evidence 仅由 high-suspicion remote content 构成时：
   - deterministic protected path 可继续只使用 trusted deterministic evidence
   - grounded generation 默认 fail-close to `unsupported_by_evidence`

## Execution Slices

### Slice 1: Add Suspicion Contracts

- 为 `EvidenceSource` 与 diagnostics 引入 suspicion labels / summary
- 冻结 label 集合，不在实现时自由增加命名

### Slice 2: Add Sanitized Evidence Rendering

- 在 prompt packet / answer drafting path 增加 sanitized evidence summary
- 保留原始 source trace，用于 citation / operator investigation
- 不把 sanitized summary 反写成 canonical source text

### Slice 3: Block Instructional Upgrade

- 当 remote content 带有 prompt-like imperative 时，只保留其 factual trace，不允许提升为 instruction layer
- provider-native citations / supports 进入 grounding 前走同一 suspicion path

### Slice 4: Project Suspicion Signals

- request diagnostics / observability 投影 `remoteContentSuspicionSummary`
- `Phase I` 的 abuse alerts 直接消费这一 summary，而不是重新扫描 raw text

### Slice 5: Lock Regression Cases

- official-web stable reference injection sample
- freshness/live source injection sample
- hidden-text / secret request / tool-call imperative sample
- deterministic path unaffected sample

## Interfaces To Freeze

- `packages/contracts/src/campus_contracts/models.py`
  - `EvidenceSource.remote_content_suspicion_labels: tuple[str, ...]`
  - `RemoteContentSuspicionSummary`
  - `RagResultDiagnostics.remote_content_suspicion_summary`
- `apps/app-api/src/modules/request-diagnostics.ts`
  - `RequestRemoteContentSuspicionSummary`
  - `RequestDiagnosticsSummary.remoteContentSuspicionSummary`
- `apps/app-api/src/modules/runtime-command/store.ts`
  - `RequestObservabilityFactWrite.remoteContentSuspicionSummary`

## Verification Matrix

- prompt packet regression：
  - suspicious remote content is sanitized before prompt-visible rendering
- grounding regression：
  - provider-native support carrying imperative text does not become trusted instruction
- service regression：
  - suspicious-only support downgrades to fail-close
  - deterministic protected paths continue when backed by trusted evidence
- app-api projection regression：
  - suspicion summary survives request diagnostics and observability storage
- eval regression：
  - official-web injection cases fail closed without collapsing into generic policy refusal

## Proposed Write Set

- `packages/contracts/src/campus_contracts/models.py`
- `packages/rag-specialist/src/campus_rag_specialist/prompt_packets.py`
- `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- `packages/rag-specialist/src/campus_rag_specialist/grounding_validation.py`
- `apps/app-api/src/modules/request-diagnostics.ts`
- `apps/app-api/src/modules/request-observability.ts`
- `apps/app-api/src/modules/runtime-command/store.ts`
- targeted regressions under `tests/specialist/`, `tests/evals/`, and `apps/app-api/test/`

## Exit Rule

Phase G 完成后，repo 应达到：

- remote content 的 suspicion labels 和 sanitization boundary 已冻结
- remote content 再也不能直接作为 prompt instruction layer 使用
- suspicion signals 已进入 diagnostics / observability，并可被后续 abuse controls 复用
- `Phase H/I` 不再需要重新决定 remote-content hardening 的输入接口
