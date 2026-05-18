---
doc_type: gap_report
phase: phase-01-current-tool-surface-inventory
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Drift Gap Report

## Confirmed Gaps

| Gap | Evidence | Risk | Closeout phase |
| --- | --- | --- | --- |
| Tool truth is hardcoded in Go only | `allowedToolsByTarget` is a local map in `runtimepolicy/tools.go` | New tool additions can drift from Python adapters, eval denominators, and docs | Phase 2 / Phase 3 |
| No canonical registry artifact | `configs/runtime/` has intent and query-serving artifacts, but no tool registry | Provider schemas and eval denominators have no common source | Phase 2 |
| `service_guide_lookup` bridge decoding is missing | `bridge_payload_codecs.py` handles status, transport, contact, notice, and RAG, but not service guide | Go can preplan a service-guide handoff that Python cannot decode | Phase 4 |
| Python adapter checks are local to each domain agent | Campus services and notice adapters each check `tool_name in request.allowed_tools` | No shared target/payload/tool boundary catches wrong-family tools before delegate execution | Phase 4 |
| Provider function schemas do not exist | No repo-owned ToolSpec-to-function-schema generation artifact | Future provider-native tool loops could hand-write schemas and drift from contracts | Phase 5 |
| Tool lifecycle is represented but not registry-validated | Workflow trace supports `tool_call_summaries`, selected tools and argument summaries | Raw result redaction and lifecycle fields can drift by caller | Phase 6 |
| Eval denominator is fixture-owned, not registry-guarded | `tool_family_denominators.v1.json` lists tool labels separately | Adding/removing a tool can leave eval coverage stale | Phase 7 / Phase 9 |

## Non-Gaps

- `retrieval.query` is intentionally not a Go preplanned structured tool. It is
  a domain-agent internal retrieval step that must remain governed by retrieval
  profile and evidence policy.
- `navigation-agent` has no active tool in this workstream. `place_lookup`
  remains closed until navigation rollout explicitly opens it.
- Browser, MCP, raw SQL, collector crawl, object-store read, ingestion/index
  build, and state-changing tools are out of scope for provider-native function
  calling.

## Required Guardrails

1. ToolSpec must validate unique tool names, supported owners, payload kinds,
   read-only posture, and provider-schema eligibility.
2. Go runtime policy must derive or drift-check allowed tools against ToolSpec.
3. Python bridge/dispatch must fail closed when `allowed_tools` is missing,
   wrong-family, duplicated, or inconsistent with payload kind.
4. Provider function schemas must be generated from ToolSpec plus DTO schema
   metadata, never hand-written per provider call site.
5. Eval denominators must prove every active structured tool has should-call,
   no-call, fail-close, and trace coverage.
