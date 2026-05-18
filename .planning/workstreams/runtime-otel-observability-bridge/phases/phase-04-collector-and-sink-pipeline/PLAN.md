---
doc_type: phase_plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Collector And Sink Pipeline

Status: completed on 2026-05-01.

## Goal

Provide a repo-owned local/staging Collector or equivalent adapter pipeline for sanitized fan-out
to Sentry/Axiom.

## Tasks

1. Decide exact config location for local/staging telemetry pipeline.
2. Add Collector/debug exporter configuration or adapter config.
3. Configure memory limiting, batching, attribute redaction/filtering and sampling.
4. Document Sentry/Axiom env setup without committing secrets.
5. Add smoke instructions and config validation where tooling supports it.

## Acceptance

- Local debug sink can receive representative sanitized telemetry.
- Sentry/Axiom production credentials stay outside tracked files.
- Runbook explains how to verify received events and diagnose drops.
