---
doc_type: phase_plan
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Untrusted Content And Tool Guardrails

## Objective

Treat retrieved/source/projected content as data, not instructions, and prevent it from changing
tool policy, routing policy or answer safety policy.

## Dependencies

- Phase 1 has hardened handoff/tool admission.
- Phase 3 has established evidence/claim grounding boundaries.
- Phase 0 gap matrix proves whether RAG product paths reach provider/function/tool runtime files.
  Without that proof, provider/tool runtime files are verification targets only, not edit targets.

## Desired End State

- Retrieved chunks, source HTML, OCR text, notice bodies and projection summaries are delimited as
  untrusted evidence.
- Source text cannot request arbitrary URL fetch, hidden prompt disclosure, new tools or policy
  override.
- Tool calls are bounded by ToolSpec and argument validation, not by prompt-only warnings.
- Prompt-injection style fixtures fail before final product response.

## Primary Code Targets

- `packages/rag-agent/src/campus_rag_agent/prompt_packets.py`
- `packages/rag-agent/src/campus_rag_agent/service_answer_synthesis.py`
- `packages/rag-agent/src/campus_rag_agent/remote_content_hardening.py`
- `packages/rag-agent/src/campus_rag_agent/grounding_validation.py`
- `packages/rag-agent/src/campus_rag_agent/prompts/rag_answer_v1.md`
- `packages/rag-agent/src/campus_rag_agent/prompts/rag_no_answer_v1.md`
- Provider/tool runtime files below are conditional targets only when Phase 0 proves a RAG product
  path reaches that boundary:
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/provider_function_calling.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/provider_tool_runtime.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/provider_tool_runtime_policy.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/tool_function_schema.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_dispatch.py`

## Primary Test Targets

- `tests/agent/rag_agent_request_prompt_contract_suite.py`
- `tests/agent/rag_agent_request_prompt_grounding_suite.py`
- `tests/agent/rag_agent_official_web_guardrails_suite.py`
- `tests/agent/rag_agent_answer_grounding_suite.py`
- `tests/supervisor/provider_function_calling_suite.py`
- `tests/supervisor/provider_tool_runtime_suite.py`
- `tests/supervisor/tool_function_schema_suite.py`
- `tests/supervisor/agents_sdk_closeout_guardrails_suite.py`
- `tests/evals/workflow_trace_gate_suite.py`

## TDD Plan

1. Add failing prompt fixture tests:
   - retrieved content says "ignore previous instructions" and answer must not follow it.
   - retrieved content asks to reveal prompts or hidden context and answer must not reveal it.
   - retrieved content asks to cite a fake source and answer must preserve citation policy.
2. Add failing tool guardrail tests:
   - source-requested arbitrary URL fetch is rejected.
   - source-requested tool expansion is rejected.
   - tool arguments cannot include raw source body unless ToolSpec explicitly allows it.
3. Add failing workflow trace tests:
   - guardrail outcome appears as safe summary.
   - raw malicious source body is not written to workflow trace/eval canonical output.
4. Add failing RAG response tests:
   - malicious content either gets quarantined with safe answer or fails closed with deterministic
     no-answer reason.

## Implementation Steps

1. Harden prompt packets.
   - Add explicit evidence delimiters if missing.
   - Label source content as untrusted.
   - Separate instructions from evidence data.
2. Harden remote content detection.
   - Expand suspicion labels for instruction override, tool exfiltration, hidden prompt requests and
     arbitrary fetch requests.
   - Keep labels deterministic and explainable.
3. Harden synthesis behavior.
   - Block prompt generation when high-risk source content is detected.
   - Prefer deterministic no-answer with `remote_content_suspicion_blocked` or more precise reason.
4. Harden tool/function boundaries.
   - Enforce ToolSpec arguments independent of prompt text.
   - Keep `allowed_tools` as the hard policy source.
   - Edit provider/function/tool runtime files only when Phase 0 identifies a concrete RAG path
     through that boundary; otherwise verify existing guardrails and keep implementation in RAG
     prompt/evidence/grounding files.
5. Update eval/trace.
   - Add safe `guardrail_outcome` and failure attribution.
   - Ensure raw malicious content is never emitted to canonical eval/panel/trace output.

## Write Set

Allowed:

- RAG prompt packet/prompt/remote content/grounding files
- Supervisor tool/function policy files only when Phase 0 proves a RAG product path reaches that
  boundary
- Focused tests/fixtures for guardrails
- Phase summary/state

Not allowed:

- General web browsing sandbox
- Moderation/HITL/state-changing approval lanes
- Broad provider framework migration
- Reopening already governed SDK/provider tool runtime lanes without a Phase 0 RAG-boundary trigger
- Storing raw malicious content in workflow traces or canonical eval assets

## Verification

Run focused tests:

```bash
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_request_prompt_contract_suite \
  tests.agent.rag_agent_request_prompt_grounding_suite \
  tests.agent.rag_agent_official_web_guardrails_suite \
  tests.agent.rag_agent_answer_grounding_suite \
  tests.supervisor.provider_function_calling_suite \
  tests.supervisor.provider_tool_runtime_suite \
  tests.supervisor.tool_function_schema_suite \
  tests.supervisor.agents_sdk_closeout_guardrails_suite \
  tests.evals.workflow_trace_gate_suite
```

Run lint/format:

```bash
uv run --all-packages ruff check \
  packages/rag-agent/src/campus_rag_agent \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker \
  tests/agent tests/supervisor tests/evals
uv run --all-packages ruff format \
  packages/rag-agent/src/campus_rag_agent \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker \
  tests/agent tests/supervisor tests/evals \
  --check
```

Run docs lint if prompt markdown changes:

```bash
pnpm docs:lint
```

## Exit Criteria

- Malicious retrieved instructions cannot override answer/tool/routing policy.
- Tool arguments and allowed tools are enforced outside prompt text.
- Guardrail failures are stage-attributed and trace-safe.
- Prompt markdown and packet structure clearly separate instructions from evidence.

## Risks

- Risk: false positives block legitimate policy text containing imperative language.
  Mitigation: require multiple high-risk signals or specific suspicious patterns before blocking;
  record suspicion labels in diagnostics.
- Risk: prompt-only guardrails are brittle.
  Mitigation: pair prompt delimiters with tool argument validation and output guardrail tests.
- Risk: tests accidentally store malicious raw content in canonical eval output.
  Mitigation: use fixtures locally and assert redacted/safe trace projections.
