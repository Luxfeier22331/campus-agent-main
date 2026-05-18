---
doc_type: summary
status: completed
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Summary: SDK-only Domain-Agent Execution Hardcut

## Completed Scope

- Worker delegates now treat `sdk_adapter_admitted` structured tools as SDK-required and fail
  closed when SDK runtime admission, runner, config or query service is missing.
- Domain-specific structured execution moved behind package-owned SDK executors in
  `packages/campus-services-agent` and `packages/notice-agent`.
- Production-importable direct online adapter modules were deleted from the campus-services and
  notice packages.
- Retired repo-owned provider-loop/pilot runtime modules were removed from the worker runtime,
  settings, readiness surface, tests and eval exports.
- Structured runtime tests were rewritten around SDK-only execution, current AgentSpec/ToolSpec
  truth, and package-owned executor boundaries.
- Guard tests now block:
  - direct adapter module reintroduction;
  - worker/runtime references to old direct delegate symbols; and
  - reintroduction of a second provider-function-calling substrate for structured domain tools.
- Provider function schema generation remains single-source from ToolSpec payload contract metadata,
  and the snapshot was refreshed to match current admitted tool truth.
- Workstream and architecture docs were updated to describe the implemented SDK-only structured
  runtime rather than the removed pilot/provider-loop shape.

## Reopen Rule

Reopen this workstream only if:

- a `sdk_adapter_admitted` structured tool regains direct adapter fallback or a parallel runtime
  substrate;
- repo-owned provider-loop / pilot runtime code is reintroduced into worker, package, test or eval
  surfaces;
- package-owned SDK executors stop being the only production structured execution owner for admitted
  domain tools; or
- ToolSpec / provider function schema / guard coverage drifts so that SDK-only structured execution
  is no longer single-truth.
