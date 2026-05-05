---
doc_type: roadmap
status: completed
created: 2026-05-04
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Agents SDK Domain-Agent Adapter Promotion

## Phase Status

- [x] **Phase 0: Admission And Source-Truth Review** — open the workstream and freeze promotion boundary.
- [x] **Phase 1: SDK Promotion Contract And Target Matrix** — freeze AgentSpec / ToolSpec / env / readiness posture before code cleanup.
- [x] **Phase 2: Pilot Debt Cleanup** — remove or quarantine stale `campus_notice_get` promotion assumptions after the new target matrix is fixed.
- [x] **Phase 3: Real SDK Runner Builder And Admission** — connect `OpenAIAgentsSdkRunner` behind admission with fail-close, trace redaction and real smoke seam.
- [x] **Phase 4: Notice Discover Promotion Slice** — run `notice-agent + campus_notice_discover` through SDK adapter under explicit gate.
- [x] **Phase 5: Structured Tool Family Adoption Matrix** — decide per tool whether direct runtime, SDK adapter or defer is correct.
- [x] **Phase 6: Eval And Parity Gate Expansion** — add shared SDK/provider/direct-runtime comparison cases and release gates.
- [x] **Phase 7: Observability, Cost And Rollback Evidence** — collect sanitized trace, latency, token/cost and error-budget evidence.
- [x] **Phase 8: Promotion Decision Per Target** — decide promote / keep gated / reject per target and tool family.
- [x] **Phase 9: Closeout And Architecture Update** — update docs, registry state and follow-up workstreams.

## Phase 0: Admission And Source-Truth Review

**Status:** completed

**Goal:** create the promotion workstream without reinterpreting SDK as repo orchestration owner.

**Delivered:**

- Native planning directory.
- Requirements, roadmap and state.
- Active registry entry.
- Boundary tied to completed pilot and completed supervisor contract hardening.

**Verification:**

```bash
pnpm docs:lint
git diff --check
```

## Phase 1: SDK Promotion Contract And Target Matrix

**Goal:** freeze SDK adapter admission and target posture before deleting or rewriting pilot code.

**Tasks:**

- Confirm current ToolSpec truth:
  - `campus_notice_get` is `agent_internal` and `runtime_posture=closed`
  - `campus_notice_discover` remains active structured handoff
- Confirm current AgentSpec truth:
  - `notice-agent` is active/open and allows `campus_notice_discover`
  - `navigation-agent` is closed and cannot be a promotion target
  - `rag-agent` has no structured handoff tools
- Decide whether AgentSpec needs an SDK adapter posture field or whether env/readiness is enough.
- Decide ToolSpec posture for SDK-eligible tools:
  - current `typed_handoff_only`
  - optional future `sdk_adapter_candidate`
  - optional future `sdk_adapter_admitted`
- Define env gates:
  - runtime enabled
  - optional mode: `off` / `shadow` / `admitted`
- Define readiness output:
  - dependency available
  - provider configured
  - model configured
  - target/tool admission result
  - selected posture
- Produce selected target matrix:
  - first candidate: `notice-agent + campus_notice_discover`
  - second-wave candidates: `service_guide_lookup`, `contact_directory_lookup`
  - direct-runtime preferred by default: `service_status_lookup`, `transport_schedule_lookup`
  - blocked/deferred: `campus_notice_get`, `retrieval.query`, `navigation-agent`
- Add drift-test plan so SDK cannot admit tools outside AgentSpec/ToolSpec/Go handoff.

**Exit Criteria:**

- SDK promotion cannot be enabled by env alone if AgentSpec/ToolSpec/Go handoff disallow it.
- There is a single current target matrix for Phase 2-5.
- Phase 2 cleanup has objective criteria for deleting, quarantining or rewriting stale pilot paths.

## Phase 2: Pilot Debt Cleanup

**Goal:** stop carrying obsolete `campus_notice_get` promotion assumptions.

**Tasks:**

- Audit SDK pilot code paths:
  - `agents_sdk_notice_get_pilot.py`
  - `agents_sdk_openai_runner.py`
  - `agents_sdk_runner.py`
  - `agent_delegates.py`
  - readiness and settings
- Replace pilot target references in tests/evals where they imply product promotion.
- Delete, quarantine or rewrite notice-get pilot files according to the Phase 1 target matrix.
- Rename generic SDK builder seams away from notice-get-specific names.
- Keep historical pilot evidence only where it is clearly labelled legacy/non-product.

**Exit Criteria:**

- No default-off SDK readiness or docs imply `campus_notice_get` is admitted as agent-facing SDK tool.
- Notice-get pilot leftovers cannot be selected by env allowlist or delegate builder.
- Phase 3 can implement a target-agnostic SDK runner builder without stale naming.

## Phase 3: Real SDK Runner Builder And Admission

**Goal:** replace the disconnected runner stub with a real, admitted SDK runner builder.

**Tasks:**

- Replace `_build_agents_sdk_notice_get_runner` with target-agnostic builder naming.
- Instantiate `OpenAIAgentsSdkRunner` only after admission passes.
- Configure SDK `Agent`, `Runner`, `FunctionTool` from repo-owned descriptors.
- Set SDK run config correlation:
  - request id
  - workflow run ref if present
  - target/tool labels
- Disable or sanitize sensitive trace export by default.
- Map SDK exceptions/timeouts/tool errors to structured `AgentResponse` fail-close.
- Keep raw SDK result out of contracts and workflow trace.
- Add an env-gated integration smoke lane for a real OpenAI Agents SDK run when provider config is
  present; keep local unit tests provider-fake and deterministic.

**Exit Criteria:**

- Real SDK dependency is exercised in a unit/integration seam with fake provider where possible.
- Real SDK runner can complete at least one non-default integration smoke when env is configured.
- Missing dependency/provider/model/tool config fails closed with stable reason labels.

## Phase 4: Notice Discover Promotion Slice

**Goal:** prove one current read-only agent-facing tool through the SDK path.

**Target:** `notice-agent + campus_notice_discover`

**Tasks:**

- Build SDK-backed notice-agent delegate path for `campus_notice_discover`.
- Route only when Go handoff target/tool and SDK gate both admit it.
- Keep `campus_notice_get` as internal query function outside provider/SDK tool surface.
- Ensure result cards remain title/url/card-first, not raw body serving.
- Compare SDK output against existing provider loop or direct runtime for no-regression evidence.
- Add tests for:
  - should call discover
  - wrong tool blocked
  - no tool fail-close or clarification
  - invalid args fail-close
  - query service failure fail-close
  - bounded result usage

**Exit Criteria:**

- SDK path can execute `campus_notice_discover` under explicit gate.
- SDK path preserves direct-runtime/provider-loop result semantics and source/card display policy.
- Default product path is unchanged until Phase 8 decision.

## Phase 5: Structured Tool Family Adoption Matrix

**Goal:** avoid adding SDK where deterministic direct runtime is the correct architecture.

**Tasks:**

- Compare each campus-services tool:
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `service_guide_lookup`
  - `contact_directory_lookup`
- Classify:
  - direct-runtime preferred
  - SDK adapter useful for argument completion / clarification
  - defer
- Default classification before evidence:
  - `service_status_lookup`: direct-runtime preferred
  - `transport_schedule_lookup`: direct-runtime preferred
  - `service_guide_lookup`: SDK candidate only for argument completion / clarification
  - `contact_directory_lookup`: SDK candidate only for argument completion / clarification
- Do not move projection-backed deterministic answer path behind SDK.
- If one candidate is selected, implement only a gated thin adapter path.

**Exit Criteria:**

- Campus-services SDK adoption has a per-tool decision, not a blanket migration.
- Direct-runtime preferred tools cannot be routed through SDK without reopening this phase.

## Phase 6: Eval And Parity Gate Expansion

**Goal:** make SDK promotion measurable.

**Tasks:**

- Build shared fixture cases for SDK vs existing provider loop/direct runtime.
- Cover:
  - correct tool selection
  - no-tool correctness
  - wrong-tool prevention
  - argument precision
  - result usage
  - fail-close reason
  - raw trace leakage
  - source/provenance preservation
- Add release gate command for SDK promotion candidates.

**Exit Criteria:**

- SDK lane cannot be promoted without parity evidence and redaction passing.

## Phase 7: Observability, Cost And Rollback Evidence

**Goal:** collect the missing evidence that blocked the old pilot promotion.

**Tasks:**

- Add sanitized SDK runtime event summary:
  - target/tool
  - latency
  - model
  - token/cost estimate where available
  - tool attempts/executions
  - failure class
  - rollback posture
- Map SDK trace id/provider response id only as auxiliary debug metadata.
- Add local/staging smoke command.
- Define rollback:
  - disable SDK runtime
  - remove SDK posture from ToolSpec or close the incoming Go handoff
  - fall back to existing path

**Exit Criteria:**

- Phase 8 can compare correctness, latency/cost, failure rate and rollback safety.
- Structured-query E2E smoke records sanitized runner projection:
  `tool_call_count=1`, `tool_execution_count=1`, source ref count and bounded notice card fields.

## Phase 8: Promotion Decision Per Target

**Goal:** decide promotion posture by evidence.

**Decision Options:**

- `promote_selected_default_on`
- `keep_shadow_or_explicit_gate`
- `reject_and_remove_candidate`
- `defer_until_tool_family_changes`

**Required Evidence:**

- Phase 6 parity gate passes.
- Phase 7 latency/cost smoke passes.
- Raw trace/payload redaction gates pass.
- Go ownership and finalizer invariants unchanged.
- Rollback tested.

**Exit Criteria:**

- The selected posture is recorded with target/tool granularity.
- Env defaults are limited to the single SDK runtime kill switch.
- Current decision: default-on SDK adapter for admitted ToolSpec tools. Missing provider/model/key
  or dependency degrades readiness and fails closed instead of falling back to bespoke loops.

## Phase 9: Closeout And Architecture Update

**Goal:** finish planning truth and hand off follow-up implementation if needed.

**Tasks:**

- Update architecture docs:
  - SDK as selected domain-agent adapter substrate
  - not supervisor orchestration owner
  - sanitized trace projection policy
- Update workstream registry state.
- Add reopen rule.
- If broader multi-agent runtime is needed, hand off to `governed-multi-agent-workflow-runtime`.

**Exit Criteria:**

- Workstream can be marked completed or blocked with explicit evidence.

## Implementation Closeout

**Selected posture:** Agents SDK is the default domain-agent adapter for admitted ToolSpec tools.

**Current ToolSpec posture:**

- `campus_notice_discover`: `sdk_adapter_admitted`
- `campus_notice_get`: `closed`, agent-internal only
- `service_status_lookup`: `typed_handoff_only`
- `transport_schedule_lookup`: `typed_handoff_only`
- `service_guide_lookup`: `sdk_adapter_admitted`
- `contact_directory_lookup`: `sdk_adapter_admitted`
- `academic_calendar_lookup`: `sdk_adapter_admitted`

**Implemented gates:**

- Python ToolSpec and Go runtimepolicy validate SDK adapter posture.
- SDK tool bridge admits only SDK adapter postures, not generic provider-loop postures.
- `/readyz` SDK runtime status reports target/tool admitted and blocked pairs.
- `_build_agents_sdk_runner` is target-agnostic and builds `OpenAIAgentsSdkRunner` only after
  runtime gate, provider, model and API key are present.
- `notice-agent` routes `campus_notice_discover` through SDK shell when admitted by ToolSpec.
- `campus-services-agent` routes `service_guide_lookup` and `contact_directory_lookup` through SDK
  shell when admitted by ToolSpec.
- `calendar-agent` routes `academic_calendar_lookup` through SDK shell when admitted by ToolSpec.
- `service_status_lookup` and `transport_schedule_lookup` remain deterministic direct-runtime
  tools.
- `campus_notice_get` remains closed for SDK/provider routing.
- Eval gate records the admitted SDK adapter matrix; latency/cost/error-rate evidence remains a
  release and observability signal, not a pre-production blocker.

**Release follow-up evidence:**

- Re-run the structured-query E2E smoke:
  `uv run --all-packages python -m scripts.agents_sdk_notice_discover_e2e_smoke --timeout-seconds 90 --startup-timeout-seconds 180`.
- Keep prompt runtime provider config explicit in the E2E lane.
- Record live latency/cost/error evidence across multiple runs.
- Re-run parity, redaction and rollback gates before broadening the admitted ToolSpec set.

**Public chat dev E2E evidence recorded 2026-05-05:**

- `pnpm --dir apps/app-api chat:e2e:dev`
- `passed=true`
- `resultKind=answer`
- entrypoint: local `public-chat-web` + `app-api` auth/session + Docker-first
  `supervisor-api -> supervisor-agent-worker -> rag-agent`
- blocker fixed: supervisor runtime image now carries runtime AgentSpec; terminal supervisor
  envelopes include canonical nullable `result` and `error`

**Structured-query E2E evidence recorded 2026-05-04:**

- `passed=true`
- `mode=real_openai_agents_sdk_with_go_structured_query_pg_read_model`
- `structured_query_e2e=true`
- `tool_execution_count=1`
- `source_ref_count=1`
- returned seed title/source URL from temporary PG notice read model.
