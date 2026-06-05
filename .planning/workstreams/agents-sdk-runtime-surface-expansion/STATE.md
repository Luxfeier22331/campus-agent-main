---
doc_type: state
workstream: agents-sdk-runtime-surface-expansion
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# State: Agents SDK Runtime Surface Expansion

## Current Position

**Status:** Completed
**Completed Phase:** Phase 7
**Last Activity:** 2026-05-06
**Last Activity Description:** Closed the generic runtime-surface expansion line after completing
 admitted SDK surface expansion and returning governed workflow step-internal SDK work to
 `governed-multi-agent-workflow-runtime`.

## Baseline Facts

- `agents-sdk-domain-agent-adapter-promotion` is completed and already admits selected read-only
  structured tools under `runtime_posture=sdk_adapter_admitted`.
- `rag-agent-internal-agents-sdk-loop` is completed and owns the RAG-internal SDK semantic loop.
- Admitted SDK domain-agent surfaces already produce final user-facing answers through the SDK
  runner; before this workstream they all shared one generic instruction string.
- Current SDK expansion work should stay within worker/domain-agent runtime substrate and not reopen
  Go workflow ownership.

## Current Slice

Completed in this slice:

- new native workstream planning truth
- SDK instruction profile registry for `notice-agent`、`campus-services-agent`、
  `calendar-agent` and a generic admitted-surface profile
- runner-shell propagation of `instruction_profile_id` and `instructions`
- safe `agents_sdk_runner_projection.instruction_profile_id`
- OpenAI/mock SDK runner consumption of request-scoped instructions
- focused runner-shell tests for notice discover and campus services service-guide profiles
- campus-services per-tool profile split for service-guide / service-status / transport /
  contact-directory
- safe observability propagation for `result_usage_mode` and `surface_execution_mode`
- focused delegate-path parity assertions for notice / campus-services / calendar admitted surfaces
- Docker-backed local supervisor runtime health revalidated
- real-provider `public-chat-web -> app-api -> supervisor-api -> supervisor-agent-worker ->
  rag-agent SDK` acceptance succeeded with `prompt_runtime_state=rag_sdk_completed`
- local smoke wrapper teardown no longer emits spurious `pnpm ELIFECYCLE` noise after success
- SDK shell now returns bounded `result.payload_kind + tool_result` for admitted campus-services
  surfaces when repo-owned tool execution occurs
- service-guide/contact SDK tool results now retain minimal nested fact groups and source refs for
  downstream structured answer synthesis
- internal notice multimodal processing now supports `INTERNAL_NOTICE_MULTIMODAL_RUNTIME` with
  `chat_completions` and `agents_sdk` lanes through one repo-owned processor builder
- the SDK-backed multimodal lane accepts inline image inputs, returns only normalized
  `InternalNoticeMultimodalDecision`, and does not persist raw SDK/provider payloads
- internal notice runtime smoke now checks multimodal runtime readiness generically instead of
  assuming chat-completions-only endpoint semantics

## Completion Summary

- Admitted single-surface SDK expansion is complete for:
  - domain-agent read-only structured surfaces
  - RAG internal SDK loop product-path acceptance
  - campus-services structured result passthrough
  - ingestion-side internal notice multimodal SDK adapter
- Future governed workflow step-internal SDK runtime is no longer tracked here.
- That scope belongs to `governed-multi-agent-workflow-runtime`.

## Verification

Focused verification for the current slice:

```bash
uv run --all-packages python -m unittest tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_notice_get_pilot_suite tests.supervisor.agents_sdk_trace_projection_suite -q
uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_multimodal_processing tests.ingestion.test_internal_notice_consumption_runtime_smoke tests.ingestion.test_process_internal_notice_multimodal_worker tests.ingestion.test_internal_notice_multimodal_eval -q
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/internal_notice_multimodal_processing.py packages/ingestion-core/src/campus_ingestion_core/internal_notice_multimodal_processing_processor.py packages/ingestion-core/src/campus_ingestion_core/internal_notice_consumption_runtime_smoke.py apps/ingestion-worker/src/campus_ingestion_worker/smoke_internal_notice_consumption_runtime.py tests/ingestion/test_internal_notice_multimodal_processing.py tests/ingestion/test_internal_notice_consumption_runtime_smoke.py
pnpm docs:lint
```

Fresh evidence, 2026-05-06:

- focused supervisor SDK suites: `Ran 36 tests ... OK`
- focused ingestion multimodal suites: `Ran 40 tests ... OK`
- current slice `ruff check`: passes for the touched ingestion/runtime files
- `pnpm --dir apps/app-api chat:e2e:local-real-provider`: passed with `profile=dev`,
  `passed=true`, `resultKind=answer`, `promptRuntimeState=rag_sdk_completed`,
  `chat_request_attempted=true`, `blocked_by=null`
- `pnpm docs:lint`: `Summary: 0 error(s)`

## Reopen Rule

- Reopen only if a new admitted single-surface SDK expansion slice appears outside
  `governed-multi-agent-workflow-runtime`, or if completed SDK surface evidence drifts and needs
  renewed hardening.
