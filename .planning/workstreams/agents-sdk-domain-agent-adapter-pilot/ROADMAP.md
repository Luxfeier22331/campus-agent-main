---
doc_type: roadmap
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Agents SDK Domain-Agent Adapter Pilot

## Phase Status

- [x] **Phase 0: Workstream Admission And Boundary Freeze** — create native workstream, freeze scope, non-goals, phase sequence, and relation to existing tool/multi-agent workstreams.
- [x] **Phase 1: SDK Runtime Dependency And Admission Gate** — add default-off SDK dependency/readiness posture without executing SDK runs.
- [x] **Phase 2: ToolSpec To SDK Tool Bridge** — derive or verify SDK function tool surface from ToolSpec + Go allowed_tools.
- [x] **Phase 3: SDK Runner Shell And Fail-Close Mapping** — implement SDK-backed runner seam that consumes AgentRequest and returns AgentResponse only.
- [x] **Phase 4: First Read-Only Pilot** — run one gated `campus_notice_get` or `campus_notice_discover` SDK tool loop.
- [x] **Phase 5: Trace Projection And Observability Parity** — map SDK run/tool summaries into repo-owned sanitized workflow trace projection.
- [x] **Phase 6: Eval Denominator And Parity Harness** — compare SDK pilot with existing custom provider function-call loop using shared fixtures.
- [x] **Phase 7: Runtime Posture Decision** — decide whether SDK replaces the custom loop for selected tools, stays experimental, or is rejected.
- [x] **Phase 8: Closeout Guardrails And Docs** — completed.

## Phase 0: Workstream Admission And Boundary Freeze

**Status:** completed

**Goal:** create the workstream and make the SDK boundary explicit before code changes.

**Deliverables:**

- Native workstream directory.
- Requirements, roadmap, state, and initial phase plans.
- Active registry entry in `.planning/WORKSTREAMS.md`.
- Clear split from `execution-tool-calling-governance` and deferred
  `governed-multi-agent-workflow-runtime`.

**Verification:**

```bash
pnpm docs:lint
git diff --check
```

## Phase 1: SDK Runtime Dependency And Admission Gate

**Status:** completed

**Goal:** introduce SDK dependency and default-off runtime posture without changing behavior.

**Scope:**

- Add `openai-agents` dependency to `apps/supervisor-agent-worker`.
- Add env/config parsing for SDK runtime gate.
- Add readiness summary for SDK runtime admission.
- Add tests for disabled, missing dependency/config, invalid allowed target/tool, and admitted summary.

**Exit Criteria:**

- Default path remains unchanged when gate is off.
- Readiness exposes stable reason labels.
- No SDK run is executed in this phase.

**Completion Notes:**

- Added `openai-agents` dependency to `apps/supervisor-agent-worker`.
- Added `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED`,
  `SUPERVISOR_AGENTS_SDK_ALLOWED_TARGETS`, and
  `SUPERVISOR_AGENTS_SDK_ALLOWED_TOOLS`.
- Added `agents_sdk_runtime` readiness summary with default-off posture and stable
  fail-close reasons.
- Added focused policy, readiness, settings, and contract guardrail tests.

## Phase 2: ToolSpec To SDK Tool Bridge

**Status:** completed

**Goal:** make SDK tool definitions subordinate to repo-owned ToolSpec.

**Scope:**

- Build or validate SDK tool descriptors from ToolSpec + generated function schema.
- Refuse tools not present in Go `allowed_tools`.
- Preserve read-only posture, timeout, max result size, result projection, and fail-close reason.
- Add drift guard showing SDK tool surface cannot define a new canonical tool.

**Completion Notes:**

- Added a repo-owned `AgentsSdkToolDescriptor` bridge derived from ToolSpec and generated provider
  function schema.
- Added fail-close validation for missing, unknown, duplicate, inactive, non-structured,
  non-read-only, missing-schema, non-strict, and non-provider-posture tools.
- Added bounded runtime policy projection fields for read-only posture, timeout, max result size,
  result projection, and stable fail-close reason.
- Added source guard proving Phase 2 does not import or execute Agents SDK runtime, hosted tools,
  object store, collector, ingestion, index build, or raw SQL surfaces.

## Phase 3: SDK Runner Shell And Fail-Close Mapping

**Status:** completed

**Goal:** add an SDK runner seam that is safe even before opening a real pilot.

**Scope:**

- New Python SDK adapter module with injectable runner/provider.
- Input: `AgentRequest`, target, allowed tools, user goal, bounded context.
- Output: `AgentResponse` only.
- Map SDK exceptions, no tool call, wrong tool, invalid args, malformed final output, and timeout into structured fail-close responses.
- Ensure raw SDK response is not serialized into contracts/panel/eval.

**Completion Notes:**

- Added an injectable `AgentsSdkRunner` shell that consumes repo-owned `AgentRequest`, Phase 2
  ToolSpec-derived descriptors, target, user goal, allowed tools, request id, and bounded context.
- Added repo-owned runner result DTOs for `final_output`, tool call summary, and model response ref
  without importing or executing SDK-native runtime.
- Mapped disabled runtime, ToolSpec bridge rejection, no tool call, multiple tool calls, wrong tool,
  invalid arguments, malformed final output, timeout, malformed runner result, and runner exception
  into structured `AgentResponse` errors.
- Added sanitized success and error projections under `AgentObservability.safe_details` without raw
  SDK response, SDK run state, or SDK trace leakage.

## Phase 4: First Read-Only Pilot

**Status:** completed

**Goal:** prove one SDK-backed domain-agent tool loop under explicit env gate.

**Preferred Target:** `campus_notice_get`

**Scope:**

- Enable only when SDK runtime gate and allowed target/tool gate are both true.
- Use ToolSpec-derived schema and repo-owned tool executor.
- Keep single-call or serial loop; no provider parallel tool call.
- Compare final answer and tool lifecycle with existing provider function-call pilot.

**Completion Notes:**

- Added repo-owned SDK tool execution injection to the runner shell with fail-close handling for
  missing execution, execution failure, multiple executions, and executed-vs-reported argument
  drift.
- Added the explicit-gate `notice-agent + campus_notice_get` SDK pilot adapter, delegating actual
  tool execution through the existing notice-agent query service.
- Added an isolated OpenAI Agents SDK runner wrapper that builds SDK `FunctionTool` instances from
  ToolSpec-derived descriptors and returns only repo-owned `AgentsSdkRunResult`.
- Wired `agent_delegates.py` so the SDK pilot is preferred only when the SDK runtime gate admits
  exactly `notice-agent` and `campus_notice_get`; otherwise existing provider/native paths remain.
- Added shared bounded notice get projection for the provider loop and SDK pilot.

## Phase 5: Trace Projection And Observability Parity

**Status:** completed

**Goal:** make SDK behavior inspectable without leaking SDK-native trace.

**Scope:**

- Extract sanitized run id/correlation id, tool call summary, latency, outcome, and fail-close reason.
- Project into existing workflow trace / diagnostics surface.
- Ensure OpenAI trace URL/id remains debug metadata only if admitted.
- Add tests preventing raw SDK trace/model output leakage.

**Completion Notes:**

- Added sanitized SDK trace and tool lifecycle projections under `AgentObservability.safe_details`.
- Added latency, failure class, retryable, tool attempted, call/execution counts, argument-key-only,
  runtime posture, and model response ref fields.
- Preserved notice-agent observability while merging SDK pilot trace/lifecycle projections.
- Added guard coverage proving raw SDK/provider trace fields are omitted from safe details and SDK
  lifecycle facts cover provider tool-call projection concepts needed for Phase 6.

## Phase 6: Eval Denominator And Parity Harness

**Status:** completed

**Goal:** prove SDK pilot correctness against existing tool-calling denominator.

**Scope:**

- Add focused eval cases for should-call, no-call, wrong-tool prevention, argument precision, fail-close, and result usage.
- Run SDK lane and custom provider function-call lane against comparable fixtures.
- Record differences as runtime decision evidence, not product opening truth.

**Completion Notes:**

- Added the `agents_sdk_notice_get_parity.v1` fixture with eight denominator cases.
- Added a JSON-serializable parity evaluator and sanitized observation extractor for SDK/provider
  `AgentResponse` outputs.
- Added deterministic tests that run the SDK pilot and provider tool loop through shared fake
  services and verify wrong tool, no tool, bad args, query-service failure, final-answer result
  usage, and SDK argument-drift detection.
- Provider tool-call projection now includes bounded `argument_keys` and `tool_execution_count` for
  eval comparability.

## Phase 7: Runtime Posture Decision

**Status:** completed

**Goal:** decide the SDK's long-term role after evidence exists.

**Decision Options:**

- Promote SDK adapter for selected domain-agent tool loops.
- Keep SDK adapter as experimental/offline lane.
- Reject SDK adapter and retain custom provider function-call loop.
- Defer TS/Claude/Agno alternatives until a specific runtime gap is proven.

**Decision Inputs:**

- Correctness and fail-close parity.
- Trace/eval usability.
- Latency/cost overhead.
- Dependency/runtime complexity.
- Boundary leakage risk.

**Completion Notes:**

- Added deterministic posture decision helper and tests.
- Selected posture is `keep_experimental_lane`: Phase 5 and Phase 6 evidence is useful, but Phase 7
  has no live latency/cost evidence and does not justify default-product promotion.
- Added `RUNTIME-POSTURE-DECISION.md` with evidence considered, promotion/rejection criteria,
  rollout/rollback notes, residual risks, and next allowed changes.
- No env defaults, product route, Go supervisor ownership, or current architecture truth changed.

## Phase 8: Closeout Guardrails And Docs

**Status:** completed

**Goal:** prevent SDK adoption from drifting into framework-owned architecture.

**Scope:**

- Contract guardrail updates.
- Docs/current-vs-target updates if implementation becomes accepted truth.
- Workstream state closeout and reopen rule.
- Focused verification command list.

**Completion Notes:**

- Added closeout guardrail tests covering default-off SDK posture, single target/tool scope,
  forbidden hosted/stateful tool surfaces, SDK-native/raw projection leaks, and completed
  workstream state.
- Kept SDK posture as `keep_experimental_lane`; no product default, env default, current
  architecture truth, or Go supervisor ownership changed.
- Updated execution architecture docs to record that SDK trace/lifecycle projections are sanitized
  debug/eval artifacts, not workflow trace truth.
- Moved the workstream to completed registry state with a reopen rule for SDK expansion,
  SDK/raw-trace leaks, ToolSpec / Go allowed-tools bypass, provider SDK semantic drift,
  parity evidence failure, or product promotion requests.
