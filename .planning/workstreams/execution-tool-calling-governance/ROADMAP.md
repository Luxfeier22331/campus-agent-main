---
doc_type: roadmap
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Execution Tool Calling Governance

## Phase Overview

- [x] **Phase 1: Current Tool Surface Inventory** — map current tool truth,
  allowed-tools behavior, payload/result schemas, eval coverage, and drift gaps.
- [x] **Phase 2: ToolSpec Registry Contract** — create canonical ToolSpec schema,
  registry artifact, validation, and docs contract.
- [x] **Phase 3: Go RuntimePolicy Integration** — wire or guard Go allowed-tools
  and structured planner behavior against ToolSpec.
- [x] **Phase 4: Python Domain-Agent Adapter Boundary** — make Python worker /
  domain-agent tool adapter consume only Go-allowed tools and expose no expansion path.
- [x] **Phase 5: Provider Function Schema Generation** — generate strict
  provider-native function schemas from ToolSpec and contracts.
- [x] **Phase 6: Tool Call Lifecycle And Observability** — add canonical tool call
  lifecycle projection, audit/trace fields, and bounded result projection policy.
- [x] **Phase 7: Tool Eval Denominator Hardening** — expand evals for tool
  selection, arguments, no-tool behavior, fail-close, and result usage.
- [x] **Phase 8: Provider-native Function Calling Runtime Pilot** — gated pilot for one
  low-risk tool, without replacing Go supervisor admission.
- [x] **Phase 9: Closeout And Guardrails** — finalize docs, drift guards, lint
  checks, and reopening rules.
- [x] **Phase 10: Strict Function Schema Hardening** — make provider schemas
  strict-mode compatible and clarify nullable optional fields.
- [x] **Phase 11: Provider Tool Loop Runtime** — submit bounded
  `function_call_output` back to the provider for final answer generation.
- [x] **Phase 12: Provider Runtime Fail-Close** — convert provider loop errors
  into structured `AgentResponse` failures.
- [x] **Phase 13: Provider Call Correlation** — project provider `call_id` /
  response correlation into safe workflow trace fields.
- [x] **Phase 14: ToolSpec Runtime Posture Split** — separate function schema
  availability from provider runtime admission.

## Phase 1: Current Tool Surface Inventory

**Status:** completed

**Goal:** produce the authoritative map of all current tool truth and drift gaps.

**Scope:**

- Inventory Go runtime policy tool allowlists.
- Inventory structured planner payload kinds and selected targets.
- Inventory contract payload/result classes.
- Inventory Python agent delegates and thin adapters.
- Inventory eval denominator and workflow trace fixtures.
- Classify each tool as typed tool runtime, agent handoff, retrieval-internal, or
  future/later-wave.

**Deliverables:**

- `phases/phase-01-current-tool-surface-inventory/TOOL-SURFACE-INVENTORY.md`
- `phases/phase-01-current-tool-surface-inventory/DRIFT-GAP-REPORT.md`

**Verification:**

- `rg` evidence for all known tool names.
- No source code changes required.

## Phase 2: ToolSpec Registry Contract

**Status:** completed

**Goal:** define canonical ToolSpec schema and initial registry artifact.

**Scope:**

- Add `configs/runtime/tools.v1.json`.
- Add schema validation helper and tests.
- Encode initial tool set and later-wave posture.
- Define schema refs and provider schema generation policy fields.
- Document how ToolSpec relates to `AgentRequest`, structured planner and evals.

**Deliverables:**

- `configs/runtime/tools.v1.json`
- ToolSpec schema / validator
- focused validation tests
- docs contract update

**Verification:**

- ToolSpec loads and validates.
- Duplicate tool names fail.
- Unsupported owner agent / capability family fails.
- Registry covers all currently known allowed tools.

## Phase 3: Go RuntimePolicy Integration

**Status:** completed

**Goal:** make Go runtime policy derive or verify allowed-tools truth from ToolSpec.

**Scope:**

- Load ToolSpec in `apps/supervisor-api`.
- Replace or guard `AllowedToolsForTarget` and `AllowedToolsForPayloadKind`.
- Fail closed on missing ToolSpec, version drift, unsupported payload kind or target/tool mismatch.
- Add tests for campus-services, notice, rag-agent and navigation closed posture.

**Deliverables:**

- Go ToolSpec loader / typed model
- RuntimePolicy integration
- Drift tests for planner and allowed-tools behavior

**Verification:**

- `go test ./internal/runtimepolicy ./internal/structuredplanning`
- existing intent and workflow trace fixtures still pass.

## Phase 4: Python Domain-Agent Adapter Boundary

**Status:** completed

**Goal:** make Python worker consume Go tool admission without re-inferring or expanding tools.

**Scope:**

- Add explicit adapter boundary around `AgentRequest.allowed_tools`.
- Fail closed when payload kind and allowed tool set mismatch.
- Ensure domain-agent delegates only expose permitted tool adapters.
- Add tests for missing, extra and wrong-family tools.

**Deliverables:**

- Python adapter boundary helpers
- focused bridge / dispatch tests
- docs update for Python worker posture

**Verification:**

- focused unittest for bridge parser and agent dispatch
- `uv run --all-packages ruff check ...`

## Phase 5: Provider Function Schema Generation

**Status:** completed

**Goal:** generate provider-native function schemas from repo-owned ToolSpec and contract DTOs.

**Scope:**

- Map ToolSpec payload schema refs to provider function schemas.
- Enforce strict schema shape and no unknown parameters.
- Snapshot schemas for first tool set.
- Keep provider schema generation out of `packages/contracts` runtime types.

**Deliverables:**

- function schema generation script / module
- schema snapshots
- tests for strict schema, enum preservation and drift

**Verification:**

- schema snapshot check
- contract generation check
- Python focused unittest

## Phase 6: Tool Call Lifecycle And Observability

**Status:** completed

**Goal:** standardize tool call lifecycle and bounded result projection.

**Scope:**

- Define `tool_call_id`, step id and workflow run linkage.
- Add argument summary and result projection policy.
- Add audit/metrics/workflow trace fields with low-cardinality labels.
- Ensure raw tool result does not leak to panel/eval/prompt.

**Deliverables:**

- lifecycle DTO or internal projection contract
- Go finalizer / audit projection updates
- eval artifact field updates
- observability tests

**Verification:**

- Go execution / observability tests
- workflow trace gate focused tests
- no raw payload leakage snapshots

## Phase 7: Tool Eval Denominator Hardening

**Status:** completed

**Goal:** expand eval coverage from final answer correctness to tool behavior correctness.

**Scope:**

- Add should-call vs no-call cases.
- Add selected tool and argument precision checks.
- Add fail-close correctness cases.
- Add hallucinated tool-call prevention cases.
- Add tool output usage checks.

**Deliverables:**

- updated `packages/evals` fixtures
- runner/report updates
- acceptance profile for tool calling governance

**Verification:**

- focused eval tests
- existing tool denominator remains compatible

## Phase 8: Provider-native Function Calling Runtime Pilot

**Status:** completed

**Goal:** prove provider-native function calling can run inside a domain-agent without
replacing Go supervisor admission.

**Scope:**

- Choose one low-risk read-only tool, preferably `campus_notice_get` or
  `service_status_lookup`.
- Feed only Go-allowed tool schema to provider loop.
- Validate arguments, execute thin adapter, project bounded result and return
  `AgentResponse`.
- Keep behind explicit env / test-only gate.

**Deliverables:**

- gated adapter runtime pilot
- strict function-call test fixture
- negative tests for disallowed tool and schema mismatch

**Verification:**

- focused Python tests
- no production opening by default

## Phase 9: Closeout And Guardrails

**Status:** completed

**Goal:** prevent future drift and mark the workstream complete.

**Scope:**

- Update architecture / contracts / runbooks as needed.
- Add drift guard for ToolSpec vs Go/Python/eval fixtures.
- Add lint or test hook for new tool additions.
- Define reopen rule.

**Deliverables:**

- closeout summary
- guard tests
- updated `.planning/WORKSTREAMS.md`

**Verification:**

- `pnpm docs:lint`
- `pnpm yaml:lint`

## Phase 10: Strict Function Schema Hardening

**Status:** completed

**Goal:** align provider function schemas with Responses strict-mode requirements.

**Scope:**

- Require every object property in strict schemas.
- Encode optional fields as nullable values instead of omitting them from
  `required`.
- Preserve enum values and nested `additionalProperties=false`.
- Refresh provider function schema snapshot.

**Verification:**

- `tests.supervisor.tool_function_schema_suite`
- `uv run --all-packages python -m campus_supervisor_agent_worker.tool_function_schema --check`

## Phase 11: Provider Tool Loop Runtime

**Status:** completed

**Goal:** implement a real provider function-calling loop for the gated notice get pilot.

**Scope:**

- Send only Go-admitted tool schemas.
- Disable parallel tool calls for single-step runtime.
- Execute the repo-owned query service after provider arguments are validated.
- Submit bounded `function_call_output` with the original provider `call_id`.
- Use the second provider response only for final answer text.

**Verification:**

- `tests.supervisor.provider_function_calling_suite`
- `tests.supervisor.provider_tool_runtime_suite`

## Phase 12: Provider Runtime Fail-Close

**Status:** completed

**Goal:** prevent provider runtime failures from escaping as unstructured bridge errors.

**Scope:**

- Classify missing calls, wrong tools, bad arguments, malformed final responses
  and provider request failures.
- Return structured `AgentResponse` errors with safe `AgentObservability`.
- Keep runtime disabled / unsupported posture explicit.

**Verification:**

- `tests.supervisor.provider_tool_runtime_suite`
- `tests.api.supervisor_api_settings_and_health_suite`

## Phase 13: Provider Call Correlation

**Status:** completed

**Goal:** make provider call identity debuggable without replacing repo-owned workflow ids.

**Scope:**

- Keep Go-generated `tool_call_id` as the canonical lifecycle id.
- Project provider `call_id` / response id through sanitized
  `provider_tool_call_projection`.
- Copy the projection into Go workflow trace tool-call summaries.

**Verification:**

- `apps/supervisor-api/internal/httpapi` focused tests

## Phase 14: ToolSpec Runtime Posture Split

**Status:** completed

**Goal:** make schema availability separate from runtime admission.

**Scope:**

- Replace `provider_schema.enabled` semantics with `function_schema.available`.
- Add explicit `runtime_posture`.
- Publish readiness fields for schema availability, runtime enabled and runtime
  admitted state.

**Verification:**

- `tests.supervisor.tool_spec_registry_suite`
- `apps/supervisor-api/internal/runtimepolicy` focused tests
- `pnpm decomposition:lint`
- focused Go/Python/eval tests
- `git diff --check`
