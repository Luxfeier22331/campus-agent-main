---
doc_type: phase_summary
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Summary: Untrusted Content And Tool Guardrails

## Status

Completed as acceptance-only in current worktree.

## Accepted Guardrail Placement

Phase 0 found no need to edit provider/tool runtime files. The current RAG product path is guarded
through:

- supervisor ToolSpec/runtime policy for allowed tools
- `WorkflowAgentContext` bounded projection refs
- RAG prompt grounding and remote content hardening
- workflow trace/eval raw payload leakage gates

## No-Opening Proof

- No arbitrary URL fetch, browsing sandbox, general web fallback or provider-hosted web search was
  added.
- `retrieval.query` remains an internal retrieval step / observability label, not a user-facing or
  provider-facing structured handoff tool.
- Retrieved chunks, source HTML/OCR and projection summaries remain untrusted data.

## Verification Evidence

```bash
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_request_prompt_grounding_suite \
  tests.agent.rag_agent_official_web_guardrails_suite \
  tests.evals.workflow_trace_gate_suite \
  tests.supervisor.tool_spec_registry_suite
```

Result: included in the 223-test focused gate.

## Deferred Work

State-changing tool approval, HITL recovery, general moderation lanes and browsing sandbox work
remain outside this workstream.
