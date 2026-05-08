---
doc_type: roadmap
status: completed
created: 2026-05-07
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Roadmap: SDK-only Domain-Agent Execution Hardcut

## Phase Status

- [x] **Phase 1: Hard-Cut Routing** — make `sdk_adapter_admitted` SDK-required in worker delegates
  and remove SDK-preference/direct-fallback branching.
- [x] **Phase 2: Package-Owned SDK Tool Executors** — move bounded structured tool execution into
  package-owned SDK executor modules.
- [x] **Phase 3: Delete Direct Online Adapters** — remove direct package online adapter APIs and
  update exports/tests.
- [x] **Phase 4: Canonical SDK Observability** — make lifecycle projection single-source across all
  admitted structured SDK tools.
- [x] **Phase 5: Config And Readiness Hardening** — make missing SDK runtime/config fail closed and
  publish stable readiness reasons.
- [x] **Phase 6: Test Migration And Coverage** — rewrite direct delegate tests into SDK-shell /
  package executor tests and preserve query service unit coverage.
- [x] **Phase 7: Regression Guards** — add repo guards against direct fallback, adapter reintroduction
  and schema drift.
- [x] **Phase 8: Docs And Closeout** — update architecture docs, state, completion evidence and
  reopen rules.

## Phase 1: Hard-Cut Routing

**Goal:** remove worker-side dual execution decisions.

**Tasks:**

- Audit `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_delegates.py`.
- Remove `_should_route_to_agents_sdk` or reduce it to a fail-closed admission assertion.
- For every `sdk_adapter_admitted` ToolSpec:
  - require SDK runner
  - require provider/model/key/config
  - require Go `allowed_tools`
  - require function schema generation
- Remove runtime branches that fall back from an SDK-admitted structured handoff to:
  - `delegate_to_campus_services_agent(...)`
  - `delegate_to_notice_agent(...)`
  - package direct `dispatch_tool_request(...)`
- Keep non-SDK-admitted agent-internal paths explicit. Example: `campus_notice_get` is
  `agent_internal`, not `sdk_adapter_admitted`, so Phase 1 must not break it.
- Add tests proving SDK-disabled / SDK-missing means stable fail-close, not direct execution.

**Exit Criteria:**

- Runtime cannot answer an SDK-admitted structured request without SDK runner admission.
- No worker delegate branch says or behaves as SDK preferred / direct fallback.
- Missing internal query service for an SDK-admitted structured tool returns SDK runtime
  fail-close projection, not a package direct runtime error.

## Phase 2: Package-Owned SDK Tool Executors

**Goal:** keep worker as SDK shell and move domain execution semantics into domain packages.

**Tasks:**

- Add `packages/campus-services-agent/src/campus_services_agent/sdk_tool_executor.py`.
- Add `packages/notice-agent/src/campus_notice_agent/sdk_tool_executor.py`.
- Move bounded query-service call and result projection out of worker bridge helpers where they are
  domain-specific.
- Keep executor inputs repo-owned DTO / dict payloads, not SDK-native objects.
- Keep executor outputs bounded tool result DTOs suitable for SDK function output.
- Preserve existing query service / HTTP query client ownership.

**Exit Criteria:**

- Worker bridge only adapts SDK function call input/output and delegates domain execution to package
  executors.
- Domain package tests cover executor payload validation, query-service failure and bounded result
  projection.

## Phase 3: Delete Direct Online Adapters

**Goal:** remove production-importable direct online runtime paths.

**Tasks:**

- Delete or retire direct online adapter modules:
  - `campus_services_agent/tool_adapter.py`
  - `campus_services_agent/service.py`
  - `campus_notice_agent/tool_adapter.py`
  - `campus_notice_agent/service.py`
- Update `__init__.py`, package exports and tests to point at SDK executors or query services.
- Keep query service modules and pure projection helpers.
- If tests require local helpers, place them under test fixtures with names that cannot be confused
  with runtime adapter APIs.

**Exit Criteria:**

- `rg "delegate_to_campus_services_agent|delegate_to_notice_agent|dispatch_tool_request"` has no
  production online-runtime hit.
- Package public API does not expose direct structured execution for SDK-admitted tools.

## Phase 4: Canonical SDK Observability

**Goal:** all admitted structured tool execution emits one lifecycle vocabulary.

**Tasks:**

- Review:
  - `agents_sdk_runner_projection`
  - `agents_sdk_trace_projection`
  - `agents_sdk_tool_lifecycle_projection`
- Ensure every SDK-admitted tool records:
  - target
  - tool
  - runner admission outcome
  - function schema version
  - tool call count
  - tool execution count
  - executor outcome
  - bounded result use
  - fail-close reason
- Remove direct-path-specific observation labels.

**Exit Criteria:**

- Eval / workflow trace can compare all SDK-admitted structured tools with the same projection
  fields.
- Raw SDK/provider/tool payload remains redacted.

## Phase 5: Config And Readiness Hardening

**Goal:** config readiness matches hard-cut runtime semantics.

**Tasks:**

- Audit worker settings and readyz for SDK runtime gate.
- Define `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED=false` as unavailable for SDK-admitted tools.
- Add readiness reasons for:
  - dependency missing
  - runtime disabled
  - provider key missing
  - model missing
  - ToolSpec schema unavailable
  - target/tool not admitted
- Ensure Go aggregation does not present direct fallback availability for SDK-admitted structured
  tools.

**Exit Criteria:**

- Readiness and runtime fail-close reasons are stable and aligned.
- SDK runtime disabled is visible as a controlled unavailability state, not hidden fallback.

## Phase 6: Test Migration And Coverage

**Goal:** make the new execution model the only tested production model.

**Tasks:**

- Rewrite tests that assert direct delegate behavior into:
  - SDK shell tests
  - package SDK executor tests
  - query service unit tests
- Keep pure query service tests independent from SDK/provider.
- Add failure coverage for wrong tool, missing schema, invalid args, query-service failure, no SDK
  runner and bounded result misuse.
- Update eval gates that previously compared direct/runtime parity so they assert SDK-only
  semantics.

**Exit Criteria:**

- Test suite no longer treats direct adapter as a valid online runtime denominator.
- Focused supervisor/agent tests pass.

## Phase 7: Regression Guards

**Goal:** prevent future fallback or schema drift.

**Tasks:**

- Add guard test for forbidden worker fallback imports / function names.
- Add guard test for forbidden production direct adapter module names.
- Add guard test that every `sdk_adapter_admitted` tool has generated provider schema from
  `payload_schema_ref`.
- Add guard test that worker runtime cannot import package direct adapter APIs.
- Add decomposition/lint coverage if a new guard file is needed.

**Exit Criteria:**

- Reintroducing direct online adapter code fails a deterministic guard test.
- Reintroducing hand-written provider schema for ToolSpec payloads fails a deterministic guard test.

## Phase 8: Docs And Closeout

**Goal:** record SDK-only execution as the accepted worktree truth for admitted structured tools.

**Tasks:**

- Update architecture docs that describe tool calling / SDK adapter / execution architecture.
- Update this workstream `STATE.md` with verification evidence.
- Update `.planning/WORKSTREAMS.md` completion status and reopen rule after implementation.
- Record remaining non-blocking follow-ups, if any, as separate seeds rather than compatibility
  paths.

**Exit Criteria:**

- Docs, code and tests agree on SDK-only structured domain-agent execution.
- Workstream can move to completed with a reopen rule limited to SDK-only regression, schema drift
  or new tool-family admission.
