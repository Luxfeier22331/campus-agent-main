---
doc_type: owner_runtime_matrix
status: backlog
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 MD060 -->

# Owner Runtime Matrix

## Purpose

This matrix freezes the positive ownership model for transport baseline + notice override. It keeps
the workstream from becoming a planner patch or a query-time notice/RAG scan.

## Owner Matrix

| Owner | Owns | Must Not Own |
|-------|------|--------------|
| `packages/ingestion-core` / notice consumption data plane | Offline notice routing, media/OCR/multimodal processing, extraction into admitted projection/read-model truth, searchable-only exclusion. | Online answer planning, public product routing, final answer composition, query-time raw notice promotion. |
| `notice-agent` / notice producer surface | Bounded `notice_change_set` artifact producer over admitted notice projection truth; source refs with title/source URL; fail-close reason when no admitted change exists. | Raw portal scraping, raw OCR/HTML delivery, deciding stable transport baseline, synthesizing final user answer. |
| `campus-services-agent` | `transport_schedule_lookup` stable schedule baseline and source-backed service facts from current read model. | Authenticated notice classification, raw notice search, deciding whether notice text overrides baseline without a change-set artifact. |
| `apps/supervisor-api` structured runtime | Admission, `CapabilityPlan -> resolver -> WorkflowPlan`, step budget, projection refs, workflow trace, finalizer invariant, fail-close terminal semantics. | Semantic extraction from raw documents, provider prompt reasoning, retrieval backend details, bypassing artifact registry with scenario branches. |
| `apps/supervisor-agent-worker` | Private bridge validation, agent delegate dispatch, SDK runner assembly when a planned step requires Python semantic execution. | Replanning the workflow, widening allowed tools/source scope, accepting raw projection payloads in place of refs. |
| `rag-agent` | Grounding over bounded artifacts and evidence refs; emits `evidence_bundle` / `grounding_verdict` when synthesis needs cross-source evidence. | Discovering raw notices, deciding transport baseline truth, making unsupported override facts answer-eligible. |
| `supervisor-api-finalizer` | User-facing answer assembly from declared artifacts, source title/source URL inclusion, conflict/clarification/no-answer rendering. | Treating `grounding_verdict` as answer-bearing evidence, inventing missing schedule/change facts, hiding artifact usage from trace. |
| `packages/evals` | Denominator cases, trace assertions, release/opening gates, regression attribution. | Serving as source truth for schedule or notice content. |
| `public-chat-campus-services-e2e-acceptance` | Public entry acceptance after this workstream produces runtime opening evidence. | Defining the artifact contract or source-truth admission policy. |

## Workflow Ownership

The admitted runtime path must be:

```text
Go supervisor admission
-> CapabilityPlan
-> artifact resolver
-> WorkflowPlan
-> schedule_baseline producer
-> notice_change_set producer
-> optional grounding/evidence step
-> Go finalizer
```

Planner may classify the request into a capability family, but it must not encode a fixed
transport override step list. The resolver owns executable step selection from artifact registry
truth.

## Data Ownership

| Artifact | Source Truth Owner | Runtime Producer | Consumer |
|----------|--------------------|------------------|----------|
| `schedule_baseline` | `campus_services_transport_schedule_read_model` | `transport_schedule_lookup` | `notice_change_set` workflow, finalizer, optional grounding |
| `notice_change_set` | `notice_consumption_projection` plus transport change read model | proposed `campus_notice_change_set_lookup` | finalizer, optional grounding |
| `evidence_bundle` | retrieval/core evidence over bounded refs | `rag-agent` internal retrieval/grounding step | finalizer |
| `grounding_verdict` | RAG grounding validator | `rag-agent` | finalizer control artifact |

## Forbidden Couplings

- No query-time source-truth inventory scan.
- No query-time portal fetch.
- No query-time OCR or multimodal extraction.
- No raw object storage locator in workflow context.
- No planner keyword branch that hard-codes transport override workflow.
- No SDK/provider-native type in `packages/contracts`.
- No `review_later` / `manual_review_required` runtime state.
