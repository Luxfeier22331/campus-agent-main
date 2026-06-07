---
doc_type: boundary_decision
workstream: academic-calendar-campus-services-consolidation
phase: phase-0-inventory-and-boundary-freeze
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Boundary Decision: Academic Calendar Campus Services Consolidation

## Decision

`academic_calendar_lookup` becomes a `campus-services-agent` structured read-only tool.

`calendar-agent` must not remain an active AgentSpec target after this workstream completes.

## Frozen Ownership

| Concern | Owner After Migration | Notes |
| - | - | - |
| Runtime agent owner | `campus-services-agent` | Academic calendar is a deterministic campus service lookup, not a standalone agent family. |
| Tool name | `academic_calendar_lookup` | Keep existing tool name and payload/result DTOs. |
| Runtime capability | `campus_services` | Academic calendar opens through the existing campus services gate. |
| Data-plane corpus/collection | `calendar/academic_calendar` | Keep source truth, projection, release target and typed read model. |
| Structured query backend | Go `apps/supervisor-api/internal/structuredquery` | Keep existing academic calendar read-model query service. |
| Python execution shell | `apps/supervisor-agent-worker` -> `campus-services-agent` | Keep SDK-admitted handoff path; do not create Go typed-tool-runtime exception. |
| Public product surface | No new surface | This is runtime-owner consolidation only. |

## Why The Boundary Moves

Academic calendar behavior is a single projection-backed structured lookup:

- teaching week facts
- holiday facts
- makeup-class facts
- academic-calendar guidance from current projection

It does not need:

- an independent agent family
- a separate capability lane
- an independent product opening flag
- separate Python package ownership
- separate SDK profile target

The correct long-term execution shape is:

```text
supervisor-api
-> single_step plan
-> campus-services-agent
-> academic_calendar_lookup thin adapter
-> internal structured query service
-> calendar/academic_calendar typed read model
```

## Data-Plane Boundary

This workstream does not rename or delete:

- `calendar/academic_calendar`
- `academic_calendar_read_model`
- `configs/ingestion/calendar/academic_calendar`
- `academic_calendar_projection.v1`
- official-web selected write target `calendar/academic_calendar`

The data plane remains calendar-named because it describes source/projection truth. The runtime
agent owner changes because it describes execution/capability ownership.

## Runtime Policy Boundary

Academic calendar intent signals remain useful, but they are no longer capability/lane truth.

After migration:

- academic calendar fact/guide signals infer `campus_services`
- planner chooses `academic_calendar_lookup` as a campus-services subtype
- `requested_capability=academic_calendar` is not normalized to campus services
- `SUPERVISOR_API_OPEN_CAPABILITIES=campus_services` is sufficient to admit the path
- `SUPERVISOR_API_OPEN_CAPABILITIES=academic_calendar` is invalid

## Agent Boundary

`campus-services-agent` owns the following structured campus service tools after migration:

- `service_status_lookup`
- `service_guide_lookup`
- `transport_schedule_lookup`
- `contact_directory_lookup`
- `academic_calendar_lookup`

This does not make `campus-services-agent` a generic RAG agent. It remains a projection-backed
structured runtime family.

## Forbidden Follow-Ups

- Do not move academic calendar into `rag-agent`.
- Do not move academic calendar into `navigation-agent`.
- Do not move academic calendar into `notice-agent`.
- Do not keep `calendar-agent` as an inactive-but-accepted alias.
- Do not open a separate academic calendar capability flag.
- Do not rename data-plane artifacts as part of this runtime-owner migration.
- Do not replace the current PostgreSQL/read-model query path with query-time raw scans.
