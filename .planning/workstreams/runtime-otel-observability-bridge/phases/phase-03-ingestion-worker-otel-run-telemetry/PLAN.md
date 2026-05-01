---
doc_type: phase_plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Ingestion Worker OTel Run Telemetry

Status: completed on 2026-05-01.

## Goal

Add runtime-owned telemetry for offline canonicalization, chunking, embedding and index release
runs while keeping `ingestion-core` business logic vendor-neutral.

## Tasks

1. Identify ingestion worker entrypoints for canonicalize/chunk/embed/index release jobs.
2. Add runtime telemetry adapter and run-level event envelope.
3. Emit sanitized count, latency, cost estimate, cache and failure-kind summaries.
4. Add tests for redaction and exporter failure fail-safe.
5. Update index release runbook with telemetry smoke instructions.

## Acceptance

- Focused ingestion tests pass.
- No canonical body, chunk body, OCR raw text or credential enters telemetry attributes.
- Job summary can report telemetry degraded without failing the job.
