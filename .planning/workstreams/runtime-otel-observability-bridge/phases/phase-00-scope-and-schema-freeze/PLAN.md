---
doc_type: phase_plan
status: ready
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Scope And Schema Freeze

## Goal

Freeze runtime ownership, event taxonomy, allowed attributes, forbidden fields and focused gates
before implementing any new OTel adapter code.

## Tasks

1. Audit existing telemetry code and docs:
   - `apps/supervisor-api/internal/telemetry`
   - `apps/supervisor-api/internal/config`
   - `apps/app-api/src/modules/telemetry`
   - `packages/retrieval-core/src/campus_retrieval_core/service.py`
   - `docs/decisions/adr-0010-observability-and-telemetry-stack.md`
2. Write telemetry taxonomy and attribute allowlist in architecture/runbook docs.
3. Confirm runtime ownership matrix:
   - `supervisor-api`: online trace owner
   - `supervisor-agent-worker`: retrieval observation bridge
   - `ingestion-worker`: offline run telemetry bridge
   - `app-api`: request lifecycle and trace propagation
   - Collector: redaction, sampling, fan-out
4. Define forbidden fields and test expectations.
5. Record focused verification commands for Phase 1-5.

## Acceptance

- Docs state exactly where OTel SDK is allowed and forbidden.
- Event taxonomy covers online, retrieval, ingestion and telemetry self-health.
- Attribute allowlist has no raw query/body/token fields.
- Phase 0 summary records current code facts and next implementation order.
