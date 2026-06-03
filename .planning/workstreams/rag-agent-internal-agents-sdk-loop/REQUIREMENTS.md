---
doc_type: requirements
status: completed
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Requirements: RAG Agent Internal Agents SDK Loop

## Goal

Adopt the official OpenAI Agents SDK as the internal semantic loop runtime for `rag-agent`, while
preserving repo-owned supervisor governance, retrieval truth, authorization filters, evidence
contracts, diagnostics projection and finalization.

## In Scope

- Add an internal `rag-agent` SDK runner adapter backed by official OpenAI Agents SDK.
- Wrap existing repo-owned retrieval execution as bounded SDK function tools.
- Convert SDK structured output back into existing `AgentResponse` / `RagResultPayload` shapes.
- Preserve current deterministic scope resolution, version resolution, access filtering,
  pre-retrieval fail-close and retrieval plan construction.
- Add internal RAG query intent / task-kind classification before SDK execution, so fuzzy user
  questions can be framed without pushing rewrite responsibility into the supervisor.
- Add category discovery and list-answer handling for users who do not know exact regulation names,
  policy objects or article numbers.
- Add structured list answer output with per-item citations, coverage notes and limitations.
- Add bounded category / policy-set retrieval where allowed categories and document ids are
  deterministic and the SDK cannot widen corpus, collection, authorization or serving scope.
- Add output guardrails so grounded answers cite only returned evidence source ids.
- Add fail-close behavior for no evidence, low confidence, guardrail failure, SDK timeout and SDK
  malformed output.
- Add sanitized SDK trace / tool-call projection into existing RAG diagnostics and observation
  seams.
- Add SDK conformance tests before relying on official SDK APIs, covering the currently locked
  `openai-agents` behavior for `Agent`, `Runner`, `FunctionTool`, strict JSON schema,
  structured output and tool-choice / max-turn settings.
- Add claim/span-level grounding validation so accepted answers are backed by returned evidence
  anchors, not merely by source-id membership.
- Add bounded replan semantics: the SDK can select deterministic planner query slots by default;
  semantic replan is allowed only under explicit budget, reason, trace and no-scope-widening rules.
- Keep SDK native tracing disabled by default; only sanitized repo-owned projection may enter
  diagnostics or observability.
- Freeze rollout posture before code integration. This historical workstream used candidate/shadow
  review language, but current repo truth is SDK-native fail-closed behavior without a
  user-facing fallback rollout mode.
- Add eval coverage for fuzzy real-user knowledge questions and routing-negative samples.
- Add unit, integration, eval and public/chat-style smoke coverage for the SDK RAG path.
- Reuse existing `PROMPT_RUNTIME_*` and `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED` settings where
  possible; prefer AgentSpec/runtime config over new env for target-specific posture.
- Update architecture docs to distinguish RAG-internal SDK loop from ToolSpec-admitted SDK tools.

## Out Of Scope

- Building or forking an SDK implementation.
- Replacing Go `supervisor-api` admission, routing, `WorkflowPlan` or finalizer with SDK runtime.
- Exposing `retrieval.query` as a public ToolSpec, provider tool or SDK-admitted structured handoff
  tool.
- Letting SDK directly access Qdrant, embedding backend, chunk store, object storage, SQL or raw
  canonical artifacts.
- Moving SDK-native types into `packages/contracts`.
- Using hosted web search, hosted file search, remote MCP, code interpreter, shell, filesystem or
  arbitrary HTTP tools in the RAG query path.
- Adding supervisor-side hardcoded query expansion for knowledge questions.
- Opening cross-agent multi-step workflow runtime; that remains a separate deferred workstream.
- Implementing real portal-password, account-recovery or service-guide source consumption in this
  workstream.
- Changing canonical/chunk/embedding/index release semantics.

## Success Criteria

- `rag-agent` can execute an admitted knowledge request through an internal OpenAI Agents SDK loop.
- SDK execution calls only repo-owned bounded retrieval function tools.
- SDK tool input cannot override corpus, collection, authorization filters, target document ids,
  target version ids or revision-track constraints selected by deterministic planning.
- SDK tool input cannot free-form rewrite the retrieval plan by default; it can only select
  deterministic planner query slots unless an explicit bounded replan budget has been admitted.
- SDK final output is accepted only when answer claims are backed by returned evidence anchors:
  `source_id`, bounded excerpt/span/ref and claim/list-item mapping.
- Category discovery questions such as `有哪些本科生可以申请的奖学金` retrieve admitted evidence
  and return a cited list answer rather than `needs_clarification`.
- Ambiguous procedure questions such as `奖学金怎么申请` still ask for clarification when no
  specific process, population or policy object is deterministically selected.
- Routing-negative questions such as `门户密码忘了怎么办` are not answered as current RAG knowledge;
  they remain supervisor/service-agent routing or unsupported-scope eval boundaries.
- SDK/preflight classification does not block category discovery when an admitted category has
  deterministic evidence.
- No evidence, restricted evidence, guardrail failure, SDK timeout and malformed output fail closed
  with explicit diagnostics.
- `retrieval.query` remains internal/closed in ToolSpec and absent from `rag-agent` structured
  handoff allowlist.
- Raw SDK run result, raw provider transcript, raw prompt, raw evidence dump and raw source body do
  not enter shared contracts, workflow trace, panel responses or eval canonical assets.
- SDK native tracing is off by default. If enabled later, it must pass a redaction/exporter gate
  before any trace leaves the local adapter boundary.
- Current `openai-agents` SDK API assumptions are covered by conformance tests before Phase 2
  implementation depends on them.
- Runtime posture is explicit before service integration; the implementation cannot accidentally
  keep two long-term primary RAG synthesis paths.
- Existing deterministic RAG behavior does not regress for supported query-enabled surfaces:
  `regulations/student_rules`, `regulations/institutional_rules`,
  `curriculum/curriculum_plan` and `official_web/stable_reference`.
- Public/chat product path still receives Go-finalized `SupervisorResponse`.

## Non-Goals

- Make every RAG request multi-agent.
- Replace retrieval-core ranking, fusion, dedupe or evidence shaping with model-only selection.
- Make SDK traces the observability source of truth.
- Add target-specific env variables when AgentSpec/runtime config can express the posture.
- Keep two long-term primary RAG synthesis paths.
- Do not preserve user-facing fallback modes. Legacy deterministic behavior must remain only as
  fixture evidence or explicitly retired historical context, not as a production answer route.
