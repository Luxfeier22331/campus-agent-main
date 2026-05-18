---
doc_type: phase_artifact
workstream: notice-agent-card-first-tool-boundary
phase: 00-boundary-freeze
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 MD060 -->

# Boundary Inventory: Notice Agent Card-First Tool Boundary

## Decision

`campus_notice_get` must stop being an agent-facing/provider/SDK body-serving tool.

Target posture:

- `campus_notice_discover` remains the only default agent-facing notice discovery tool.
- Selected notice resolution becomes an internal deterministic query function.
- Public notice output uses card/source-link rendering by default.
- Body/OCR/media/attachment text remains in source-truth and downstream materialization, but cannot flow into public answer text, provider/SDK tool output, workflow trace, panel canonical asset or eval canonical asset as raw full text.

## Vocabulary Freeze

- `NoticeCardSet`: user-visible discovery result containing notice cards and source links.
- `ResolvedNoticeRef`: selected notice identity plus title/source family/source URL/canonical URL/published metadata.
- `NoticeContextProjection`: bounded internal context carrying source refs, content hash, short excerpt, bounded summary or extracted facts.
- `display_policy`: output policy for public and internal uses. Initial public policies are `card_only`, `link_only`, `bounded_summary` and `fact_extraction_only`.
- `full_body_forbidden`: invariant for public answer, operator-safe workflow trace, panel canonical asset, eval canonical asset and provider/SDK tool output.

## Inventory

| Path | Current Behavior | Target Disposition |
|------|------------------|--------------------|
| `configs/runtime/tools.v1.json` | Exposes `campus_notice_get` as active `provider_loop_pilot` with strict function schema. | Remove provider-loop/default tool posture; keep selected notice reads internal or closed. |
| `packages/contracts/src/campus_contracts/models_tools.py` | `CampusNoticeGetResult` requires `normalized_body` for non-reference resolved results. | Replace with card/ref/context result semantics; resolved public result must not require body. |
| `packages/contracts/src/campus_contracts/models_shared.py` | Lists `campus_notice_get` as a shared agent tool name. | Remove from default agent-facing tool set or keep only as deprecated/internal compatibility if needed. |
| `docs/contracts/campus-notice-runtime-contract.md` | Documents get as canonical notice body read. | Rewrite to card-first and internal context semantics. |
| `apps/supervisor-api/internal/runtimepolicy/tool_registry.go` | Allows provider postures whenever function schema is available. | Add guard preventing notice body/get semantics from provider-facing schema. |
| `apps/supervisor-api/internal/structuredplanning/planner.go` | Plans selected notice follow-through as `campus_notice_get`. | Plan selected notice link/card/context resolution without body-serving tool. |
| `apps/supervisor-api/internal/httpapi/structured_direct_text.go` | Renders `title + normalized_body` for notice get. | Render title + official/source URL/card only. |
| `apps/supervisor-api/internal/structuredquery/notice.go` | Reads canonical body from object storage and returns `normalized_body`. | Keep body store internal; public result should be ref/card/context projection with display policy. |
| `apps/supervisor-api/internal/execution/*` | Carries `notice_context` workflow projections. | Ensure projection carries refs/hash/excerpt/summary/facts only, never raw body. |
| `packages/notice-agent/src/campus_notice_agent/tool_adapter.py` | Emits `title + normalized_body` for non-reference get results. | Emit source card/link; summary/fact extraction must use bounded context only. |
| `packages/notice-agent/src/campus_notice_agent/http_query_service.py` | Parses `normalized_body` from Go query result. | Parse card/ref/context fields; body field must not be used for default answer. |
| `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_notice_get_pilot.py` | Treats notice get as SDK pilot denominator. | Close or recut SDK pilot to card/resolve semantics; no body-get pilot. |
| `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/tool_function_schema.py` | Emits provider schemas from ToolSpec. | Must not emit internal notice context/body functions. |
| `tests/supervisor/*agents_sdk*` | Expect `campus_notice_get` SDK/provider pilot. | Update to card-first or closed-pilot expectations. |
| `tests/contracts/contract_models_services_and_notice_suite.py` | Requires `normalized_body` for resolved notice get. | Update to display-policy/card/context assertions. |
| `tests/evals/*` and `packages/evals/fixtures/*` | Include notice get provider/tool parity denominator. | Replace with card-first denominator and body-leak negative fixtures. |
| `docs/contracts/rag-agent-retrieval-plan-contract.md` | References `campus_notice_get` in retrieval tool context. | Reframe as notice context projection / selected ref resolution. |

## Non-Changes

- Do not remove authenticated notice source-truth body/OCR/media/attachment ingestion.
- Do not change object storage ownership.
- Do not open browser-facing notice body APIs.
- Do not make SDK the owner of notice routing or notice context admission.

## Phase Handoff

- Phase 1 owns contracts and ToolSpec.
- Phase 2 owns Go planner, direct runtime, structured query and workflow trace guard.
- Phase 3 owns Python notice-agent and provider/SDK adapters.
- Phase 4 owns eval denominator and drift guards.
- Phase 5 owns downstream bounded workflow context.
- Phase 6 owns closeout docs and opening review.
