---
doc_type: roadmap
status: completed
created: 2026-05-08
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# Roadmap: OpenAI Agents SDK Native Supervisor Runtime Hardcut

## Phase Status

- [x] **Phase 1: SDK Primitive Boundary Freeze** — freeze official SDK primitive mapping,
  current debt inventory and hard-cut acceptance gates.
- [x] **Phase 2: Native SDK Runtime Factory** — introduce one worker-owned SDK runtime factory
  that directly uses official `Agent` / `Runner`.
- [x] **Phase 3: ToolSpec To FunctionTool Compiler** — make ToolSpec the single source for all SDK
  function tools, including structured handoff tools and RAG internal tools.
- [x] **Phase 4: Structured Domain-Agent Native Runtime** — migrate campus-services / notice /
  navigation structured execution to native SDK runtime and delete custom runner shell usage.
- [x] **Phase 5: RAG Agent Native Runtime Hardcut** — make query-enabled RAG answer synthesis
  SDK-native and remove rollout/fallback modes.
- [x] **Phase 6: WorkflowPlan SDK Compiler** — compile admitted Go `WorkflowPlan` shapes into
  SDK-native single-agent, agents-as-tools or handoff execution.
- [x] **Phase 7: Observability, Guardrails And Readiness** — unify sanitized SDK trace, guardrail
  projection and fail-close readiness.
- [x] **Phase 8: Residual Deletion And Drift Guards** — delete remaining self-built runtime residue and add
  deterministic anti-regression guards.
- [x] **Phase 9: Eval And Product-Path Acceptance** — verify public-chat / supervisor / eval
  behavior against SDK-native runtime only.
- [x] **Phase 10: Docs And Closeout** — update architecture truth, registry and completion ledger.

## Phase 1: SDK Primitive Boundary Freeze

**Goal:** make the hard-cut target falsifiable before touching runtime code.

**Tasks:**

- Audit all current SDK / provider-loop / tool-use surfaces:
  - `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/*agents_sdk*`
  - `packages/rag-agent/src/campus_rag_agent/*rag_sdk*`
  - `packages/campus-services-agent`
  - `packages/notice-agent`
  - `packages/navigation-agent`
  - `configs/runtime/agents.v1.json`
  - `configs/runtime/tools.v1.json`
- Freeze the official SDK primitive mapping:
  - Go-owned `single_step` -> run the admitted target SDK agent directly
  - Go-owned manager-style `multi_step` -> SDK agents-as-tools or sequential SDK runs, with Go
    retaining final answer ownership
  - Go-owned ownership-transfer workflow -> SDK handoff only when WorkflowPlan explicitly says so
  - repo-owned query / retrieval / projection execution -> SDK `FunctionTool`
- Write `CURRENT-DEBT-INVENTORY.md` covering every custom runner, rollout mode, mock runner,
  provider-loop, direct adapter and schema duplication path.
- Write `SDK-PRIMITIVE-MAPPING.md` that maps repo-owned execution modes to official SDK primitives
  and explicitly records what remains repo-owned.
- Draft guard acceptance criteria for forbidden runtime nouns without adding a permanently failing
  test gate before the implementation slice removes the residue:
  - `shadow`, `candidate`, `fallback_only`, `rag_sdk_rollout_mode`
  - production `AgentsSdkRunner` protocol
  - custom `AgentsSdkRunRequest` / `AgentsSdkRunResult` as runtime contracts

**Exit Criteria:**

- Workstream has a current-debt audit with exact file owners.
- SDK primitive mapping is explicit and grounded in official SDK docs.
- Guard acceptance criteria are ready for implementation phases and do not leave the repo in a
  permanently failing state.
- No phase after Phase 1 depends on fallback, compatibility, shadow, candidate or dual runtime.

**Status:** completed on 2026-05-08.

**Evidence:**

- `CURRENT-DEBT-INVENTORY.md`
- `SDK-PRIMITIVE-MAPPING.md`
- planning markdownlint and diff whitespace checks recorded in `STATE.md`

## Phase 2: Native SDK Runtime Factory

**Goal:** create a single worker-owned SDK runtime entrypoint that directly uses official SDK.

**Tasks:**

- Add `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_runtime.py`
  or equivalent module.
- Build SDK `Agent` objects from repo-owned agent profiles:
  - name
  - instructions
  - output type
  - admitted tools
  - handoff / agents-as-tools inventory if admitted by WorkflowPlan
- Call official `Runner.run_sync` / `Runner.run` directly.
- Configure model/provider through existing prompt runtime provider config.
- Set SDK trace sensitivity controls:
  - `trace_include_sensitive_data=False`
  - sanitized repo projection only
- Replace test-only fake runtime with local deterministic tool executor fixtures, not production
  mock runner protocols.

**Exit Criteria:**

- Worker has one SDK runtime factory for production semantic execution.
- Production code no longer needs a repo-defined `AgentsSdkRunner` protocol to represent SDK.
- Missing dependency/provider/model/key fails closed through stable readiness reasons.

**Status:** completed on 2026-05-08 for the factory foundation; downstream call-site migration and
old custom runner deletion were completed by Phase 4 / Phase 8 on 2026-05-10.

**Evidence:**

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_runtime.py`
- `tests/supervisor/openai_agents_runtime_suite.py`
- `uv run --all-packages python -m unittest tests.supervisor.openai_agents_runtime_suite -q`

## Phase 3: ToolSpec To FunctionTool Compiler

**Goal:** make every SDK function tool derive from ToolSpec and contract schema metadata.

**Tasks:**

- Consolidate current `agents_sdk_tool_bridge.py`, `rag_sdk_internal_tool_bridge.py` and
  `tool_function_schema.py` into one compiler surface.
- Support both ToolSpec surfaces:
  - `structured_handoff`
  - `agent_internal`
- Generate SDK `FunctionTool` instances from:
  - `payload_schema_ref`
  - generated JSON schema
  - owner agent
  - runtime posture
  - strict schema flag
- Bind each tool to a repo-owned executor:
  - campus-services query service
  - notice query service / selected notice resolve
  - navigation query service
  - RAG `retrieve_evidence`
- Reject any model-supplied scope/authz/selector/budget fields for internal retrieval tools.

**Exit Criteria:**

- Structured tools and RAG internal tools use the same ToolSpec compiler.
- Hand-written provider function schema cannot drift from contract schema metadata.
- SDK tool executor receives bounded DTOs and returns sanitized result projection only.

**Status:** completed on 2026-05-10.

**Evidence:**

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_tool_bridge.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_function_tools.py`
- `tests/supervisor/agents_sdk_tool_bridge_suite.py`
- `tests/supervisor/agents_sdk_internal_tool_suite.py`

## Phase 4: Structured Domain-Agent Native Runtime

**Goal:** finish moving structured domain-agent semantic execution to SDK-native runtime.

**Tasks:**

- Replace `run_agents_sdk_runner_shell()` calls for `campus-services-agent` and `notice-agent`
  with native SDK runtime factory calls.
- Keep package-owned SDK tool executors as the only domain query execution owner.
- Ensure `campus_notice_get` remains agent-internal selected notice resolve and is not exposed as
  public structured handoff tool unless ToolSpec explicitly admits it later.
- Delete custom runner result validation that duplicates SDK result loop semantics.
- Preserve Go finalizer ownership over public `SupervisorResponse`.

**Exit Criteria:**

- `campus-services-agent` and `notice-agent` use the same SDK runtime factory as future agents.
- Domain query service errors return SDK-native fail-close projections.
- No typed structured activity or custom SDK runner shell remains for these agents.

**Status:** completed on 2026-05-10.

**Evidence:**

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/admitted_agent_execution.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_runtime.py`
- `tests/supervisor/admitted_agent_execution_suite.py`
- `tests/supervisor/openai_agents_runtime_suite.py`

## Phase 5: RAG Agent Native Runtime Hardcut

**Goal:** make RAG answer synthesis SDK-native without rollout/fallback modes.

**Tasks:**

- Replace `maybe_build_rag_sdk_response()` with a required SDK-native RAG answer drafting /
  synthesis stage that runs after repo-owned deterministic preflight, retrieval planning,
  retrieval execution and evidence selection.
- Delete `RagSdkRolloutMode`, `should_attempt_rag_sdk()`, `should_return_rag_sdk_response()`,
  `shadow`, `candidate`, `closed`, `fallback_only` and equivalent behavior.
- Compile `retrieve_evidence` from ToolSpec into SDK `FunctionTool`.
- Move final answer output schema into SDK output type with repo-owned validation.
- Preserve deterministic stages that are not provider-facing semantic generation:
  - target/scope admission from Go
  - source-trust / retrieval profile policy
  - retrieval plan construction
  - retrieval backend execution
  - evidence selection
  - no-support / insufficient evidence fail-close
  - grounding validation
- Remove non-SDK answer synthesis as a product fallback for query-enabled RAG surfaces.

**Exit Criteria:**

- Query-enabled RAG answer path completes only through SDK-native synthesis.
- SDK runtime unavailable produces stable no-answer / fail-close result, not self-built answer.
- Retrieval scope/authz/selector cannot be widened by model tool arguments.
- Deterministic retrieval/evidence stages remain repo-owned and observable.

**Status:** completed on 2026-05-10.

**Evidence:**

- `packages/rag-agent/src/campus_rag_agent/service_answer_synthesis.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_rag_runtime.py`
- `tests/agent/rag_agent_sdk_service_suite.py`
- `tests/supervisor/openai_agents_rag_runtime_suite.py`

## Phase 6: WorkflowPlan SDK Compiler

**Goal:** make admitted multi-agent workflow execution SDK-native while preserving Go ownership.

**Tasks:**

- Add a compiler from Go-owned `WorkflowPlan` / `AgentRequest.workflow_context` into SDK execution
  steps.
- Support currently admitted shapes:
  - `single_step`
  - selected notice context -> RAG follow-through
- For manager-style workflows, use sequential SDK runs or agents-as-tools while Go remains final
  owner.
- Use SDK handoff only when the WorkflowPlan declares ownership transfer.
- Enforce step budget, allowed agents, allowed tools, required projection kind and fail-close
  terminal policy from Go plan.

**Exit Criteria:**

- Python does not invent cross-agent route order at query time.
- SDK realizes only the workflow admitted by Go.
- Step outputs are bounded `StepOutputProjection` / `AgentResponse` artifacts.

**Status:** completed on 2026-05-10.

**Evidence:**

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_workflow_plan.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_v6_parser.py`
- `tests/supervisor/openai_agents_workflow_plan_suite.py`
- `tests/api/supervisor_api_bridge_handoff_suite.py`

## Phase 7: Observability, Guardrails And Readiness

**Goal:** use SDK observability without leaking SDK internals or raw data.

**Tasks:**

- Map SDK run, agent, tool, handoff and guardrail events into repo-owned sanitized projection.
- Keep `trace_include_sensitive_data=False`.
- Add stable fail-close reasons:
  - dependency missing
  - runtime disabled
  - provider key missing
  - model missing
  - schema missing
  - tool not admitted
  - plan not admitted
  - SDK malformed output
  - SDK guardrail failed
  - SDK timeout
- Align bridge readyz and Go aggregation with SDK-native runtime semantics.

**Exit Criteria:**

- Operator/eval sees one lifecycle vocabulary for SDK-native agent execution.
- Raw SDK trace, raw provider output and raw tool result are never exposed.
- Runtime readiness cannot imply a fallback path.

**Status:** completed on 2026-05-10.

**Evidence:**

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_runtime_policy.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_readiness.py`
- `tests/supervisor/agents_sdk_runtime_policy_suite.py`

## Phase 8: Residual Deletion And Drift Guards

**Goal:** delete old runtime nouns and block regression.

**Tasks:**

- Delete production custom runtime modules and dead tests:
  - custom `AgentsSdkRunner` protocol
  - `AgentsSdkRunRequest` / `AgentsSdkRunResult` runtime contracts
  - `agents_sdk_mock_runner`
  - RAG rollout mode modules / tests
  - old provider-loop or pilot residue
- Add guard tests for forbidden strings/imports:
  - `shadow`
  - `candidate`
  - `fallback_only`
  - `rag_sdk_rollout_mode`
  - `run_agents_sdk_runner_shell`
  - production `AgentsSdkRunner`
- Add schema and trace leakage guards.
- Remove Phase 1 guard-spec exceptions once implementation deletion is complete.

**Exit Criteria:**

- Forbidden old runtime names cannot be reintroduced without failing tests.
- Repo has no production code path representing SDK as a homegrown loop.

**Status:** completed on 2026-05-10.

**Evidence:**

- `tests/supervisor/openai_agents_runtime_hardcut_guardrails_suite.py`
- `tests/agent/rag_agent_sdk_rollout_suite.py`

## Phase 9: Eval And Product-Path Acceptance

**Goal:** prove SDK-native hardcut preserves product behavior and improves runtime clarity.

**Tasks:**

- Update eval denominators for:
  - tool family execution
  - RAG answer quality
  - workflow trace
  - public chat entry cases
  - supervisor bridge contract
- Run focused deterministic suites.
- Run product-path smoke for representative cases:
  - student rules factual answer
  - institutional rules source-grounded answer
  - curriculum plan answer
  - official web stable reference answer
  - transport schedule lookup
  - service status lookup
  - notice card discovery
  - selected notice -> RAG follow-through
- Confirm no query-enabled case uses old runtime fallback.

**Exit Criteria:**

- Focused SDK-native tests pass.
- Eval fixtures reflect SDK-native runtime only.
- No product-path regression is hidden by fallback answer generation.

**Status:** completed on 2026-05-10.

**Evidence:**

- Focused supervisor / bridge / contract suite recorded in `STATE.md`
- Focused RAG / product-path suite recorded in `STATE.md`

## Phase 10: Docs And Closeout

**Goal:** align repo truth after hardcut.

**Tasks:**

- Update:
  - `docs/architecture/current-architecture.md`
  - `docs/architecture/target-architecture.md`
  - `docs/architecture/system/execution-and-agents-architecture.md`
  - `docs/architecture/system/operator-observability-architecture.md`
  - `docs/architecture/system/retrieval-serving-architecture.md`
  - `docs/environment/provider-and-secret-inventory.md` if env names change
- Update `AGENTS.md` only if repo entry rules or source-of-truth navigation change.
- Update this workstream `STATE.md` and `.planning/WORKSTREAMS.md`.
- Record any out-of-scope future expansion as seeds, not compatibility code.

**Exit Criteria:**

- Architecture docs describe SDK-native Python semantic runtime as accepted worktree truth.
- Workstream can move to completed with a narrow reopen rule.

**Status:** completed on 2026-05-10.

**Evidence:**

- `GAP-LEDGER.md`
- `.planning/WORKSTREAMS.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
