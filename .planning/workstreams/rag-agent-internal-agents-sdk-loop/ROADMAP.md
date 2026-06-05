---
doc_type: roadmap
status: completed
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Roadmap: RAG Agent Internal Agents SDK Loop

## Phase Status

- [x] **Phase 0: Boundary And Readiness Review** — freeze RAG-internal SDK loop posture, rollout mode, SDK conformance gates and no public ToolSpec expansion.
- [x] **Phase 1: Internal Contract, Query Intent And Grounded Output Schema** — define `rag-agent` internal SDK request/result/output/trace/query-intent projections with claim/span grounding.
- [x] **Phase 2: SDK Conformance, Runner And Retrieval Function Tools** — verify official SDK behavior, then implement bounded retrieval/category tool bridge.
- [x] **Phase 3: Service Pipeline Integration** — wire SDK loop into `delegate_to_rag_agent` after deterministic scope/version/preflight.
- [x] **Phase 4: Guardrails, Bounded Replan And Fail-Closed Semantics** — enforce claim-backed output, authorization immutability, bounded replan and explicit failure states.
- [x] **Phase 5: Worker Assembly And Runtime Posture** — inject runner from `supervisor-agent-worker` without target-specific env sprawl.
- [x] **Phase 6: Diagnostics, Trace Projection And Observability** — project sanitized SDK execution data into existing RAG diagnostics/observation seams.
- [x] **Phase 7: Eval, Regression And Product Path Verification** — add unit/integration/eval/public-chat-style coverage.
- [x] **Phase 8: Default Path Decision And Legacy Prompt Runtime Cleanup** — decide default-on posture and remove or demote redundant prompt-executor paths.
- [x] **Phase 9: Architecture Closeout** — update docs, planning state, verification evidence and reopen rules.

## Phase 0: Boundary And Readiness Review

**Goal:** ensure the implementation starts from the correct architecture boundary.

**Tasks:**

- Reconfirm `retrieval.query` remains internal/closed in `configs/runtime/tools.v1.json`.
- Reconfirm `rag-agent` has no structured handoff tools in `configs/runtime/agents.v1.json`.
- Review current `rag-agent` pipeline entrypoints:
  - `packages/rag-agent/src/campus_rag_agent/service.py`
  - `service_pipeline.py`
  - `service_planner_stage.py`
  - `service_retrieval_stage.py`
  - `service_evidence_stage.py`
  - `service_answer_synthesis.py`
- Review existing SDK runner seams in `apps/supervisor-agent-worker`.
- Review official SDK usage already present in the repo and freeze whether the RAG path reuses or
  creates a package-local runner adapter.
- Freeze SDK conformance gate:
  - exact currently installed `openai-agents` version
  - supported `Agent`, `Runner`, `FunctionTool`, strict schema and structured output behavior
  - tool-choice and max-turn behavior needed for RAG
- Freeze runtime posture before code. Historical candidate/shadow review modes may be described as
  migration evidence, but they must not become user-facing production answer modes.
- Freeze trace posture: SDK native tracing off by default; sanitized repo projection only.
- Freeze bounded replan posture: default query-slot selection only; semantic replan requires an
  admitted budget and no widening of scope, selector, authorization, version or serving surface.
- Update architecture docs with explicit RAG-internal SDK loop boundary before implementation.

**Exit Criteria:**

- No plan item requires public ToolSpec exposure for `retrieval.query`.
- No plan item lets SDK own supervisor routing, workflow plan or finalization.
- Runtime posture and legacy prompt executor retirement are defined before service integration.
- Claim/span grounding and bounded replan are explicit implementation requirements.
- SDK conformance tests are a Phase 2 blocker.
- Raw SDK tracing is not part of default observability.
- Implementation file boundaries are identified.

**GSD Artifacts:**

- `./phases/phase-0-boundary-and-readiness-review/CONTEXT.md`
- `./phases/phase-0-boundary-and-readiness-review/RESEARCH.md`
- `./phases/phase-0-boundary-and-readiness-review/PLAN.md`

## Phase 1: Internal Contract, Query Intent And Grounded Output Schema

**Goal:** define repo-owned internal RAG SDK projections before calling SDK APIs.

**Tasks:**

- Add internal models under `packages/rag-agent/src/campus_rag_agent/`:
  - `rag_sdk_models.py`
  - `rag_sdk_output.py`
  - `rag_sdk_trace.py`
- Define:
  - `RagSdkRunRequest`
  - `RagSdkRunResult`
  - `RagSdkAnswerOutput`
  - `RagSdkEvidenceProjection`
  - `RagSdkTraceProjection`
- Define claim/evidence support models:
  - `RagSdkClaim`
  - `RagSdkEvidenceAnchor`
  - `RagSdkClaimSupport`
  - `RagSdkListItemSupport`
- Define internal query framing models:
  - `RagQueryIntent`
  - `RagTaskKind`
  - `specific_policy_lookup`
  - `category_discovery`
  - `ambiguous_procedure`
  - `fact_lookup`
  - `comparison`
  - `unsupported_scope`
- Require structured answer fields:
  - `answer_text`
  - `answer_kind`
  - `answer_items`
  - `confidence`
  - `semantic_outcome`
  - `cited_source_ids`
  - `item_source_ids`
  - `claim_support`
  - `item_support`
  - `evidence_anchors`
  - `coverage_note`
  - `limitations`
  - `unsupported_reason`
  - `needs_clarification`
  - `follow_up_question`
- Add validation helpers that reject citations not present in returned evidence ids and anchors.
- Add validation helpers that reject answer claims without returned `source_id + excerpt/span/ref`
  support.
- Add validation helpers that reject list answers when any item lacks valid returned evidence
  support.

**Exit Criteria:**

- Internal SDK output can be validated without importing SDK types.
- Output-to-`AgentResponse` mapping has deterministic tests.
- Claim/span support validation is independent of SDK native types.
- Fuzzy discovery questions can be represented as `category_discovery` without supervisor rewrite.
- Ambiguous process questions can be represented as `ambiguous_procedure` and still clarify.

## Phase 2: SDK Conformance, Runner And Retrieval Function Tools

**Goal:** use the official OpenAI Agents SDK as the loop runtime.

**Tasks:**

- Add SDK conformance tests before production adapter code depends on SDK behavior:
  - `Agent` construction with instructions/model/output schema
  - `Runner` sync/async behavior used by repo runtime
  - `FunctionTool` invocation signature and strict JSON schema behavior
  - model settings for tool choice, max turns and parallel tool call disabling
  - structured output parsing and failure behavior
- Add `rag_sdk_runner.py` that constructs SDK `Agent`, `Runner`, `FunctionTool` and structured
  output using the official SDK dependency already available in the worker environment, after
  conformance tests prove the API shape.
- Add `rag_sdk_tools.py` that wraps existing retrieval execution behind bounded tools.
- Initial tool:
  - `retrieve_evidence(query_slot_id, retrieval_intent)`
- Optional bounded replan tool, if Phase 0 admits it:
  - `replan_retrieval_query(query_slot_id, replan_reason)`
- Add bounded category discovery tools:
  - `retrieve_category_evidence(category_id, query_text)`
  - `retrieve_policy_set_evidence(query_text, allowed_document_ids)`
- Ensure tool execution reuses deterministic `retrieval_context`, `retrieval_plan`,
  authorization filter and target document/version constraints from the existing planner stage.
- Ensure category / policy-set retrieval uses a deterministic category registry or planner-selected
  allowed document ids; SDK output cannot invent category ids, widen allowed ids or expand serving
  surface.
- Ensure SDK-provided query text cannot replace deterministic planner slots unless bounded replan is
  admitted and budgeted.
- Set safe SDK runtime defaults:
  - bounded `max_turns`
  - `parallel_tool_calls=False`
  - no hosted tools
  - no arbitrary external tools
  - timeout mapped to repo runtime policy
- Add mock runner support for deterministic tests.

**Exit Criteria:**

- SDK conformance tests pass against the locked dependency version.
- SDK runner can call the bounded retrieval tool exactly through repo-owned execution.
- Tests prove the SDK cannot submit a tool call that widens scope or authorization.
- Tests prove the SDK cannot rewrite query text outside admitted planner slots or bounded replan.
- Tests prove category discovery can retrieve from admitted policy sets without requiring a known
  regulation title.

## Phase 3: Service Pipeline Integration

**Goal:** route selected `rag-agent` requests through the SDK loop at the correct stage.

**Tasks:**

- Extend `delegate_to_rag_agent` with optional `rag_sdk_runner`.
- Keep deterministic preflight and planner stage before SDK execution.
- Enforce the frozen runtime posture in service integration. The code path must not keep two
  user-facing answer synthesis substrates.
- Add query-intent classification before SDK execution and keep it inside `rag-agent`, not
  supervisor routing.
- Ensure preflight does not convert `category_discovery` into `needs_clarification` when category
  evidence can be selected deterministically.
- Preserve `ambiguous_procedure` clarification behavior for questions that ask how to apply/do a
  process without enough policy object, population or procedure scope.
- Insert SDK loop after retrieval context/plan construction and before old retrieval/evidence
  selection/answer synthesis path.
- Map SDK output into existing `AgentResponse` and `RagResultPayload`.
- Keep failure posture explicit and observable; do not silently blend SDK and legacy synthesis.

**Exit Criteria:**

- Existing non-SDK tests still pass.
- SDK path returns the same public response contract through Go finalization.
- SDK failure produces explicit fail-closed diagnostics.
- A test proves fallback cannot become an unobserved second primary synthesis path.

## Phase 4: Guardrails, Bounded Replan And Fail-Closed Semantics

**Goal:** prevent SDK model output from bypassing evidence, authorization or version semantics.

**Tasks:**

- Add tool input guardrail:
  - corpus/collection/authorization/target ids cannot be model-provided or widened.
- Add tool output guardrail:
  - only bounded evidence projection is returned to SDK.
- Add final output guardrail:
  - answer facts require claim-level support from returned evidence anchors.
  - each list answer item requires at least one valid returned evidence anchor.
  - category discovery must not clarify prematurely when admitted category evidence exists.
  - no returned evidence means no-answer or clarification only.
- Add bounded replan guardrail:
  - max replan count
  - replan reason required
  - replan cannot widen collection, surface, authorization, target document ids, target version ids
    or revision track
  - replan attempt emits sanitized observation
- Add explicit error states:
  - `rag_sdk_runtime_failed`
  - `rag_sdk_timeout`
  - `rag_sdk_guardrail_failed`
  - `rag_sdk_replan_budget_exceeded`
  - `rag_sdk_query_slot_not_admitted`
  - `unsupported_by_evidence`

**Exit Criteria:**

- Guardrail tests cover forged citations, no evidence, restricted evidence, malformed output and
  version-query drift.
- Guardrail tests cover premature clarification for category discovery and uncited list items.
- Guardrail tests cover unsupported claim spans and disallowed bounded replan.
- Failures do not produce grounded answer status.

## Phase 5: Worker Assembly And Runtime Posture

**Goal:** assemble the SDK loop from the worker without env sprawl.

**Tasks:**

- Reuse existing provider settings:
  - `PROMPT_RUNTIME_PROVIDER`
  - `PROMPT_RUNTIME_API_KEY`
  - `PROMPT_RUNTIME_BASE_URL`
  - `AGENT_PROMPT_MODEL` / `PROMPT_RUNTIME_MODEL`
  - `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED`
- Prefer AgentSpec/runtime config for `rag-agent` SDK posture rather than adding a new allowlist env.
- Update `agent_delegates.py` to inject `rag_sdk_runner` into `delegate_to_rag_agent`.
- Ensure missing SDK dependency/provider/model/key fails closed and does not preserve a production
  fallback answer route.

**Exit Criteria:**

- Worker settings remain minimal.
- Runtime readiness can explain whether RAG SDK loop is enabled, disabled or unavailable.

## Phase 6: Diagnostics, Trace Projection And Observability

**Goal:** make SDK execution debuggable without leaking raw runtime state.

**Tasks:**

- Project SDK execution into bounded diagnostics:
  - `rag_sdk_enabled`
  - `rag_sdk_tool_call_count`
  - `retrieval_query_count`
  - `selected_source_count`
  - `guardrail_state`
  - `latency_ms`
  - `model_response_ref`
  - `unsupported_reason`
- Add redaction tests for prompt, transcript, raw SDK result, raw evidence and source body.
- Connect projection to existing RAG observation / OTel-compatible event seam where available.
- Keep SDK native tracing disabled by default. If a later implementation enables native tracing, it
  must go through an explicit redaction/exporter gate before leaving the adapter boundary.

**Exit Criteria:**

- Diagnostics are useful for eval/debug but cannot reconstruct raw prompt or source body.
- Existing retrieval observation remains the runtime retrieval source of truth.
- Tests prove native SDK trace payloads are not serialized into diagnostics by default.

## Phase 7: Eval, Regression And Product Path Verification

**Goal:** prove the SDK loop is not a quality or safety regression.

**Tasks:**

- Add RAG SDK unit and integration tests.
- Add eval gates for:
  - groundedness
  - claim/span support
  - citation validity
  - category discovery/list-answer quality
  - bounded replan no-widening
  - no-evidence fail-close
  - restricted document denial
  - version-aware query preservation
  - unsupported / low-confidence behavior
- Add fuzzy real-user eval cases:
  - `有哪些本科生可以申请的奖学金` -> completed list answer with citations.
  - `我能申请哪些奖学金` -> completed list answer or constrained clarification when user-specific
    eligibility information is required.
  - `学校奖学金都有什么` -> completed list answer with citations.
  - `奖学金怎么申请` -> `needs_clarification`.
  - `国奖成绩没前十还有机会吗` -> grounded answer citing the relevant eligibility article.
  - `论文能不能算国奖条件` -> grounded answer citing the relevant eligibility article.
  - `门户密码忘了怎么办` -> routing negative; not answered as current RAG knowledge.
- Add public/chat-style smoke proving `supervisor-api -> worker -> rag-agent SDK loop ->
  Go finalizer`.
- Compare against current query-enabled surfaces:
  - `regulations/student_rules`
  - `regulations/institutional_rules`
  - `curriculum/curriculum_plan`
  - `official_web/stable_reference`

**Exit Criteria:**

- No medium-or-higher regression in RAG eval gates.
- Public product path still returns canonical `SupervisorResponse`.
- SDK conformance and trace-redaction gates remain in the release denominator.

## Phase 8: Default Path Decision And Legacy Prompt Runtime Cleanup

**Goal:** avoid long-term dual primary RAG synthesis paths.

**Tasks:**

- Decide whether SDK loop becomes default for `rag-agent` answer synthesis.
- Reconfirm Phase 0 rollout mode and update it with evidence, not preference.
- If default-on:
  - demote old prompt executor to fixture-only evidence or remove the redundant production path.
  - update tests and docs to avoid two competing primary synthesis runtimes.
- If not default-on:
  - record blockers and keep SDK as explicit gated candidate only.

**Exit Criteria:**

- There is one primary production RAG synthesis path.
- No user-facing fallback answer route remains.

## Phase 9: Architecture Closeout

**Goal:** close the workstream with durable truth.

**Tasks:**

- Update `STATE.md` with final verification evidence.
- Update `.planning/WORKSTREAMS.md` status and reopen rule.
- Update architecture docs with final default posture.
- Record remaining follow-up seeds only for work not in this workstream.

**Exit Criteria:**

- Workstream can be completed without ambiguous SDK/RAG ownership.
