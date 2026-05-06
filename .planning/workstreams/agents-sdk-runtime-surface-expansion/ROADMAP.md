---
doc_type: roadmap
workstream: agents-sdk-runtime-surface-expansion
status: active
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Agents SDK Runtime Surface Expansion

## Phase Status

- [x] **Phase 0: Scope Freeze And Workstream Bootstrapping** — create native planning truth and freeze boundary against repo-wide SDK orchestration drift.
- [x] **Phase 1: Runtime Surface Inventory And Expansion Order** — map current admitted surfaces, blocked surfaces and implementation order.
- [x] **Phase 2: SDK Instruction Profile Substrate** — add per-target/per-tool instruction profiles for admitted SDK runner surfaces.
- [x] **Phase 3: Structured Runtime Surface Hardening** — extend parity/observability/eval around campus-services, notice discover and calendar SDK surfaces.
- [x] **Phase 4: RAG SDK Default-On Product Acceptance** — recover real-provider public-chat E2E after Docker health is restored.
- [x] **Phase 5: Service-Guide / Contact Synthesis Refinement** — refine SDK-mediated source-backed guidance behavior for admitted read-only service surfaces.
- [x] **Phase 6: Offline Notice Multimodal Adapter** — add ingestion-side SDK media-review adapter behind normalized DTOs.
- [x] **Phase 7: Closeout And Follow-Up Split** — close the generic runtime-surface line and hand governed workflow step-internal SDK work back to `governed-multi-agent-workflow-runtime`.

## Phase 0: Scope Freeze And Workstream Bootstrapping

Goal: open the workstream without reinterpreting SDK as orchestration truth.

Delivered:

- native workstream directory
- requirements, roadmap and state
- active registry entry
- boundary linked to completed SDK promotion and RAG SDK loop workstreams

## Phase 1: Runtime Surface Inventory And Expansion Order

Goal: freeze what already exists versus what remains blocked.

Delivered:

- current admitted surfaces inventory:
  - `campus_notice_discover`
  - `service_status_lookup`
  - `service_guide_lookup`
  - `transport_schedule_lookup`
  - `contact_directory_lookup`
  - `academic_calendar_lookup`
  - RAG internal SDK loop
- blocked/deferred surfaces inventory:
  - real-provider public-chat acceptance while Docker is unhealthy
  - governed multi-step workflow step internals
  - offline notice multimodal/media review
- implementation order frozen in this roadmap

## Phase 2: SDK Instruction Profile Substrate

Goal: stop using one generic SDK instruction string for every admitted runtime surface.

Tasks:

- Add repo-owned instruction profiles for:
  - `notice-agent + campus_notice_discover`
  - `campus-services-agent`
  - `calendar-agent`
  - generic fallback
- Extend runner-shell request DTO with `instruction_profile_id` and `instructions`.
- Propagate profile id into safe `agents_sdk_runner_projection`.
- Update OpenAI and mock SDK runners to consume request-scoped instructions.
- Add focused runner-shell tests for notice discover and service-guide profile selection.

Exit Criteria:

- admitted SDK surfaces carry explicit profile ids
- tests prove target-specific profile routing
- no raw profile internals leak beyond safe observability summary

## Phase 3: Structured Runtime Surface Hardening

Goal: make existing admitted SDK tool surfaces release-quality as reusable runtime substrate.

Tasks:

- expand focused parity tests for campus-services / notice / calendar
- keep `allowed_tools` subset compilation strict
- add observability assertions for instruction profile and bounded result usage
- document which surfaces are exact-lookup deterministic versus SDK-mediated answer shaping

Delivered:

- campus-services profile granularity split into `service_guide` / `service_status` /
  `transport_schedule` / `contact_directory`
- runner-shell safe observability now carries `instruction_profile_id`,
  `result_usage_mode`, and `surface_execution_mode`
- focused delegate-path parity assertions now cover notice discover, campus-services admitted
  surfaces, and academic calendar
- trace projection now distinguishes deterministic lookup SDK finalization from SDK-mediated answer
  shaping

## Phase 4: RAG SDK Default-On Product Acceptance

Goal: move from focused suite success to product-path evidence.

Tasks:

- rerun local/public-chat real-provider E2E after Docker health recovers
- keep `prompt_runtime_state=rag_sdk_completed`
- ensure fallback remains observable and scoped

Delivered:

- Docker-backed local supervisor runtime health revalidated before product-path acceptance
- real-provider `chat:e2e:local-real-provider` now proves
  `public-chat-web -> app-api -> supervisor-api -> supervisor-agent-worker -> rag-agent SDK`
- acceptance evidence includes `resultKind=answer`, non-blocked readyz path, and
  `prompt_runtime_state=rag_sdk_completed`
- local smoke wrapper teardown now exits cleanly without false `ELIFECYCLE` noise after success

## Phase 5: Service-Guide / Contact Synthesis Refinement

Goal: improve SDK-mediated source-backed guidance on admitted read-only service surfaces.

Delivered:

- SDK shell completed responses now carry bounded `result.payload_kind + tool_result` for admitted
  campus-services surfaces when repo-owned tool execution occurred
- service-guide SDK tool results retain minimal nested source-backed fact groups:
  `resolved_service`、`guide_sections`、`procedure_groups`、`required_materials`、
  `entry_refs`、`office_hours`、`contact_refs`、`eligibility_notes`、`source_refs`
- contact-directory SDK tool results retain minimal nested source-backed fact groups:
  `resolved_contact`、`contact_points`、`location_refs`、`office_hours`、`source_refs`
- focused Python SDK runner/delegate suites now assert downstream structured-consumption payloads,
  not only observability summaries
- `app-api` structured campus-services answer lane revalidated against the existing
  `renders campus-services answers from structured tool facts and safe source categories` gate

## Phase 6: Offline Notice Multimodal Adapter

Goal: use SDK in ingestion-side media review without opening a public query-time tool.

Delivered:

- repo-owned `build_internal_notice_multimodal_processor_from_env(...)` now selects between
  `chat_completions` and `agents_sdk` runtimes via `INTERNAL_NOTICE_MULTIMODAL_RUNTIME`
- new `AgentsSdkInternalNoticeMultimodalProcessor` stays behind the existing normalized ingestion
  DTO seam:
  `InternalNoticeMultimodalProcessingRequest -> InternalNoticeMultimodalDecision`
- SDK lane uses inline `input_image` items and structured `output_type`, but only emits bounded
  `action / summary / extracted_text / reasons / confidence`
- runtime smoke no longer hardcodes chat-completions endpoint assumptions; it validates the active
  multimodal runtime builder generically
- existing repo-owned multimodal decision and visual eval fixtures remain valid for the new runtime
  lane

## Phase 7: Closeout And Follow-Up Split

Goal: close the generic runtime-surface line once admitted single-surface SDK expansion is done,
and return governed workflow step-internal SDK work to its owning deferred workstream.

Delivered:

- removed `Step-Internal SDK Runtime For Governed Workflow` from this workstream
- explicitly returned that future implementation scope to
  `governed-multi-agent-workflow-runtime`
- kept this workstream scoped to admitted single-surface domain-agent / worker-internal SDK
  expansion only
