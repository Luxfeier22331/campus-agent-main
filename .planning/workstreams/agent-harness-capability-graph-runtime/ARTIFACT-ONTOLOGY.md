---
doc_type: artifact_ontology
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 MD060 -->

# Artifact Ontology

## Purpose

This is the Phase 1 artifact ontology for `agent-harness-capability-graph-runtime`.

The machine-readable source is:

```text
configs/runtime/workflow-artifacts.v1.json
```

The ontology exists so planner/resolver work can reason about typed artifacts instead of hard-coding
one workflow per user scenario.

## Canonical Artifact Kinds

| Kind | Display Name | Owner | Current Support | Answer Eligible |
|------|--------------|-------|-----------------|-----------------|
| `notice_context` | `NoticeContext` | `notice-agent` | `supported_go_runtime` | yes |
| `notice_change_set` | `NoticeChangeSet` | `notice-agent` | `planned_contract_gap` | yes |
| `schedule_baseline` | `ScheduleBaseline` | `campus-services-agent` | `supported_go_runtime` | yes |
| `service_status_facts` | `ServiceStatusFacts` | `campus-services-agent` | `planned_contract_gap` | yes |
| `service_guide_facts` | `ServiceGuideFacts` | `campus-services-agent` | `contract_only` | yes |
| `contact_directory_facts` | `ContactDirectoryFacts` | `campus-services-agent` | `planned_contract_gap` | yes |
| `academic_calendar_facts` | `AcademicCalendarFacts` | `campus-services-agent` | `planned_contract_gap` | yes |
| `place_context` | `PlaceContext` | `navigation-agent` | `contract_only` | yes |
| `evidence_bundle` | `EvidenceBundle` | `rag-agent` | `supported_go_runtime` | yes |
| `grounding_verdict` | `GroundingVerdict` | `rag-agent` | `supported_go_runtime` | no |

## Support Status Semantics

- `supported_go_runtime`: Go execution runtime can construct this projection kind today.
- `contract_only`: shared execution contract or AgentSpec mentions this kind, but Go execution
  runtime does not yet construct it.
- `planned_contract_gap`: artifact is required by the harness design but has not yet been promoted
  into execution contract/runtime projection kinds.

## Current Gaps

- `notice_change_set` is required for transport/status notice overrides, but is not a runtime
  projection kind.
- `service_status_facts` is required for service status composition, but is not a runtime projection
  kind.
- `contact_directory_facts` is required for contact composition, but is not a runtime projection
  kind.
- `academic_calendar_facts` is required for calendar composition. Current AgentSpec uses
  `calendar_fact`; Phase 2 must normalize this to `academic_calendar_facts` or declare a durable
  alias.
- `service_guide_facts` and `place_context` exist in shared execution contract enum, but not in Go
  execution projection constructors.

## Raw Payload Guard

Artifacts are bounded summaries, not raw source containers.

The registry forbids raw prompt, transcript, provider trace, raw source, raw HTML, OCR dump, raw SQL,
object locator and backend dump keys. Existing workflow trace guards already cover a subset; Phase 2
must decide whether to expand shared guards or keep the stricter artifact guard in a private runtime
validator.

## Phase 1 Completion Criteria

- The artifact vocabulary is machine-readable.
- Current contract/runtime support status is explicit.
- Known naming drift is recorded.
- Focused tests lock artifact names, support status and raw-key guard expectations.
