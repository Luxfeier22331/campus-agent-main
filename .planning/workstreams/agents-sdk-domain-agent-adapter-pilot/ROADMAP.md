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
- [ ] **Phase 2: ToolSpec To SDK Tool Bridge** — derive or verify SDK function tool surface from ToolSpec + Go allowed_tools.
- [ ] **Phase 3: SDK Runner Shell And Fail-Close Mapping** — implement SDK-backed runner seam that consumes AgentRequest and returns AgentResponse only.
- [ ] **Phase 4: First Read-Only Pilot** — run one gated `campus_notice_get` or `campus_notice_discover` SDK tool loop.
- [ ] **Phase 5: Trace Projection And Observability Parity** — map SDK run/tool summaries into repo-owned sanitized workflow trace projection.
- [ ] **Phase 6: Eval Denominator And Parity Harness** — compare SDK pilot with existing custom provider function-call loop using shared fixtures.
- [ ] **Phase 7: Runtime Posture Decision** — decide whether SDK replaces the custom loop for selected tools, stays experimental, or is rejected.
- [ ] **Phase 8: Closeout Guardrails And Docs** — harden anti-leak guards, update architecture docs/current state, and define reopen rules.

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

**Status:** planned

**Goal:** make SDK tool definitions subordinate to repo-owned ToolSpec.

**Scope:**

- Build or validate SDK tool descriptors from ToolSpec + generated function schema.
- Refuse tools not present in Go `allowed_tools`.
- Preserve read-only posture, timeout, max result size, result projection, and fail-close reason.
- Add drift guard showing SDK tool surface cannot define a new canonical tool.

## Phase 3: SDK Runner Shell And Fail-Close Mapping

**Status:** planned

**Goal:** add an SDK runner seam that is safe even before opening a real pilot.

**Scope:**

- New Python SDK adapter module with injectable runner/provider.
- Input: `AgentRequest`, target, allowed tools, user goal, bounded context.
- Output: `AgentResponse` only.
- Map SDK exceptions, no tool call, wrong tool, invalid args, malformed final output, and timeout into structured fail-close responses.
- Ensure raw SDK response is not serialized into contracts/panel/eval.

## Phase 4: First Read-Only Pilot

**Status:** planned

**Goal:** prove one SDK-backed domain-agent tool loop under explicit env gate.

**Preferred Target:** `campus_notice_get`

**Scope:**

- Enable only when SDK runtime gate and allowed target/tool gate are both true.
- Use ToolSpec-derived schema and repo-owned tool executor.
- Keep single-call or serial loop; no provider parallel tool call.
- Compare final answer and tool lifecycle with existing provider function-call pilot.

## Phase 5: Trace Projection And Observability Parity

**Status:** planned

**Goal:** make SDK behavior inspectable without leaking SDK-native trace.

**Scope:**

- Extract sanitized run id/correlation id, tool call summary, latency, outcome, and fail-close reason.
- Project into existing workflow trace / diagnostics surface.
- Ensure OpenAI trace URL/id remains debug metadata only if admitted.
- Add tests preventing raw SDK trace/model output leakage.

## Phase 6: Eval Denominator And Parity Harness

**Status:** planned

**Goal:** prove SDK pilot correctness against existing tool-calling denominator.

**Scope:**

- Add focused eval cases for should-call, no-call, wrong-tool prevention, argument precision, fail-close, and result usage.
- Run SDK lane and custom provider function-call lane against comparable fixtures.
- Record differences as runtime decision evidence, not product opening truth.

## Phase 7: Runtime Posture Decision

**Status:** planned

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

## Phase 8: Closeout Guardrails And Docs

**Status:** planned

**Goal:** prevent SDK adoption from drifting into framework-owned architecture.

**Scope:**

- Contract guardrail updates.
- Docs/current-vs-target updates if implementation becomes accepted truth.
- Workstream state closeout and reopen rule.
- Focused verification command list.
