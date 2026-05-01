---
doc_type: phase_plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: E2E Smoke And Closeout

Status: completed on 2026-05-01.

## Goal

Verify online retrieval, offline ingestion and exporter failure behavior end to end, then close the
workstream with evidence and reopen rules.

## Tasks

1. Run online smoke through app/public chat or supervisor-api with trace context.
2. Run retrieval observation smoke and confirm sanitized event delivery.
3. Run ingestion/index release telemetry smoke.
4. Run negative smoke with Collector/exporter unavailable.
5. Update architecture, runbooks, `STATE.md`, `ROADMAP.md` and registry closeout.

## Acceptance

- Focused implementation tests pass.
- Local debug Collector or staging sink evidence is recorded.
- Product paths fail safe when telemetry sink is down.
- Workstream is marked completed with a clear reopen rule.
