---
doc_type: summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Summary: Execution Tool Calling Governance

## Completed Scope

- Added canonical `configs/runtime/tools.v1.json` ToolSpec registry for current
  read-only tool labels.
- Replaced Go runtimepolicy allowed-tool truth with ToolSpec-derived loading and
  fail-closed behavior.
- Added Python worker `AgentRequest.allowed_tools` dispatch admission so
  wrong-family, missing, duplicate or extra tool sets fail before delegate
  execution.
- Upgraded Python dispatch admission to load the same ToolSpec registry instead
  of keeping a hand-written payload-class allowlist.
- Fixed bridge v6 service-guide payload decoding.
- Added provider function schema generation as a worker adapter artifact with
  `packages/evals/fixtures/provider_function_tools.v1.json` snapshot.
- Added canonical tool-call lifecycle fields in Go workflow trace summaries:
  `tool_call_id`, `workflow_run_ref`, `step_id`, `lifecycle_state`,
  `result_projection`, and `raw_result_included=false`.
- Added eval denominator drift guard against ToolSpec active tools.
- Added gated provider-native `campus_notice_get` runtime adapter that exposes
  only Go-admitted tool schema and rejects provider hallucinated calls.
- Added a provider function-call adapter with injectable Responses HTTP runtime
  support; it posts only the allowed tool schema subset, preserves `call_id`,
  rejects missing / wrong / malformed calls, and keeps provider raw response out
  of the domain-agent result.
- Added worker readiness projection for provider tool runtime admission; the
  pilot remains disabled by default and currently admits only `campus_notice_get`.
- Wired admitted `campus_notice_get` notice-agent delegates to the provider tool
  runtime while keeping other notice tools on the existing typed adapter path.
- Added provider tool-call eval fixture coverage for should-call, no-call,
  wrong-tool, bad-arguments and tool-result-projection outcomes.
- Hardened provider function schemas for Responses strict mode: every object
  property is required, optional fields are represented as nullable, nested
  objects keep `additionalProperties=false`, and the snapshot is refreshed.
- Split ToolSpec `function_schema.available` from `runtime_posture` so schema
  generation cannot be confused with provider runtime opening.
- Promoted the `campus_notice_get` pilot from one-shot argument planning to a
  gated provider tool loop that submits bounded `function_call_output` with the
  original provider `call_id`, then uses the second provider response only for
  final answer text.
- Converted provider runtime failures into structured `AgentResponse` errors
  with safe `AgentObservability` instead of bridge-level exception leakage.
- Added safe provider call correlation to Go workflow trace summaries while
  keeping repo-owned `tool_call_id` as the canonical lifecycle id.

## Reopen Rule

Reopen this workstream only if:

- a query-time tool is added without ToolSpec, provider schema, eval denominator
  and Go/Python admission coverage;
- provider-native function calling is moved outside gated domain-agent adapter
  scope;
- Go `allowed_tools` stops deriving from `configs/runtime/tools.v1.json`;
- ToolSpec `function_schema.available` is treated as runtime opening instead of
  `runtime_posture`;
- raw provider trace, raw function response, raw SQL/object-store/source crawl, or
  unbounded tool output appears in workflow trace, panel, eval, prompt, or public
  answer surfaces.
