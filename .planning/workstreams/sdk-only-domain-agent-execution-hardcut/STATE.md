---
doc_type: state
workstream: sdk-only-domain-agent-execution-hardcut
status: completed
created: 2026-05-07
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# State: SDK-only Domain-Agent Execution Hardcut

## Current Position

**Status:** completed
**Current Phase:** complete
**Last Activity:** 2026-05-08
**Last Activity Description:** Marked the workstream completed after final closeout. Workstream
truth now matches the implemented runtime: structured domain-agent execution is SDK-only,
package-owned executors are canonical, direct/provider-loop residue is deleted, and repo-level
planning state is aligned.

## Current Slice

Completed slice:

- worker delegates enforce SDK-required / fail-closed semantics for `sdk_adapter_admitted` tools
- package-owned SDK executors are the only production structured execution path
- direct online adapters and repo-owned provider-loop/pilot runtime modules are removed
- guard coverage blocks fallback, direct adapter, and second-substrate reintroduction
- workstream and architecture docs reflect the implemented SDK-only runtime

## Baseline Facts

- Completed `agents-sdk-domain-agent-adapter-promotion` admitted selected read-only structured
  tools to SDK adapter posture.
- Package-owned SDK executors are now the only production structured runtime implementation for
  `sdk_adapter_admitted` domain tools.
- Current hard-cut target explicitly rejects fallback, compatibility lane and dual online runtime.
- ToolSpec and provider function schema generation are already being consolidated through contract
  schema metadata; this workstream must protect that single-source direction.

## Blockers

None recorded.

## Latest Verification

Focused runtime verification:

```bash
uv run --all-packages python -m unittest tests.supervisor.sdk_only_domain_agent_guards_suite tests.supervisor.agent_spec_registry_suite tests.supervisor.tool_function_schema_suite tests.supervisor.contract_function_schema_suite tests.supervisor.sdk_only_domain_agent_registry_truth_suite tests.agent.test_notice_runtime_wiring tests.agent.sdk_only_domain_agent_execution_suite tests.agent.test_campus_services_agent tests.agent.test_notice_agent tests.api.supervisor_api_settings_and_health_suite -q
```

Observed result:

- `Ran 73 tests in 0.730s`
- `OK`

Planning/doc closeout verification:

```bash
pnpm exec markdownlint-cli2 '.planning/workstreams/sdk-only-domain-agent-execution-hardcut/**/*.md' .planning/WORKSTREAMS.md
git diff --check
```

Observed result:

- markdown lint: pass
- diff whitespace: clean

## Continuity Notes

- Do not re-open this as a general SDK adoption discussion; the decision has already narrowed to
  hard-cut convergence for currently admitted structured domain-agent tools.
- Do not use this workstream to change Go supervisor ownership or RAG internal retrieval semantics.
- `campus_notice_get` remains an agent-internal notice resolve seam. It is not a structured
  handoff tool, not a provider/SDK function tool, and not a valid reason to reopen a second
  structured runtime substrate.
- Future SDK expansion or product/runtime opening belongs in a new workstream, not this closed one.
